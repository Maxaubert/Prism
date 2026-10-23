// Fetch the whisper.cpp CPU engine dictation bundles (#13), at build time.
//
//   node fetch-whisper.mjs <outDir>
//
// It lives in the CORE, not in an app, so Prism Terminal and Prism fetch the
// same bytes: each app's build runs it with its own <outDir> (the folder its
// electron-builder config copies to resources/bin/whisper).
//
// The engine is the OFFICIAL whisper.cpp release zip, pinned by tag and
// verified by SHA-256 (owner decision: official pinned binaries only, nothing
// we compile). The binaries are NOT committed: this is what a fresh clone and
// CI run before packaging, and re-running is free once <outDir> is populated.
//
// Plain Node, no dependencies, on purpose: it runs before `npm run build`, in
// both apps, and in a package (core-dist) that has no install step at all.
// Which is also why it cannot import core/shared/dictationCatalog.ts.
/* global console, fetch */
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

// THESE FIVE MUST SAY WHAT `ENGINE` IN core/shared/dictationCatalog.ts SAYS.
// Two copies of a pin drift silently, so dictationCatalog.test.ts reads this
// file as text and fails when they disagree. Keep each on one line, in this
// shape, or that test cannot find it.
const TAG = 'b5130'
const ASSET = 'whisper-bin-x64.zip'
const SHA256 = 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c'
const BYTES = 8573270
// The minimal set whisper-server.exe runs on, MEASURED: these thirteen alone
// in an empty folder start, load a model and transcribe. Every ggml-cpu-*.dll
// stays, because ggml picks one at run time by what the USER's processor
// supports (cascadelake on the machine this was measured on; haswell,
// sandybridge, sse42 or plain x64 on older ones). The last two are the same
// zip's Parakeet runner (#121), which needs nothing more from it, MEASURED the
// same way. The rest of the zip is other programs (the whisper CLI,
// benchmarks, tests, SDL2).
const FILES = [
  'whisper-server.exe',
  'whisper.dll',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-cpu-alderlake.dll',
  'ggml-cpu-cannonlake.dll',
  'ggml-cpu-cascadelake.dll',
  'ggml-cpu-haswell.dll',
  'ggml-cpu-icelake.dll',
  'ggml-cpu-sandybridge.dll',
  'ggml-cpu-skylakex.dll',
  'ggml-cpu-sse42.dll',
  'ggml-cpu-x64.dll',
  'parakeet-cli.exe',
  'parakeet.dll'
]
// Where the zip keeps them. They land FLATTENED in <outDir>, beside each other,
// which is what the DLL loader needs and what the engine resolver expects.
/** Microsoft's C++ runtime, copied app-local beside the engine (see below). */
const RUNTIME = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll']
const ZIP_DIR = 'Release'
const URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${TAG}/${ASSET}`

const fail = (msg) => {
  console.error('whisper: ' + msg)
  process.exit(1)
}

if (process.platform !== 'win32')
  fail('this is the Windows x64 engine; nothing to fetch on ' + process.platform)
if (!process.argv[2]) fail('usage: node fetch-whisper.mjs <outDir>')
const OUT = resolve(process.argv[2])

const stamp = join(OUT, '.source')
// EVERY file, not only the server: the stamp is the zip's checksum, which a
// new FILES list (#121 added Parakeet's two) does not change, so a folder
// fetched under the old list would otherwise pass as complete for good.
if (
  FILES.every((name) => existsSync(join(OUT, name))) &&
  existsSync(stamp) &&
  readFileSync(stamp, 'utf8').trim() === SHA256
) {
  console.log(`whisper: ${OUT} already holds ${ASSET} of ${TAG}`)
  process.exit(0)
}

console.log(`whisper: downloading ${ASSET} of ${TAG} (${(BYTES / 1e6).toFixed(1)} MB)`)
let res
try {
  res = await fetch(URL)
} catch (e) {
  fail(`download failed (${e?.cause?.code ?? e?.message ?? e})\n  ${URL}`)
}
if (!res.ok) {
  console.error(`whisper: download failed (${res.status} ${res.statusText})\n  ${URL}`)
  // GitHub keeps a release's assets for as long as the release exists, so a
  // 404 means upstream removed or renamed it, not that this machine is broken.
  // The pin is deliberate: the fix is to re-pin, never to follow `latest` and
  // lose the checksum.
  if (res.status === 404)
    console.error(
      'whisper: that release asset is gone upstream. Re-pin TAG, ASSET, SHA256 and BYTES above from\n' +
        '  https://github.com/ggml-org/whisper.cpp/releases (the whisper-bin-x64.zip of a release; its\n' +
        '  sha256 and size are on the release page and in the GitHub API as `digest` and `size`),\n' +
        '  check FILES against the new zip, and make ENGINE in core/shared/dictationCatalog.ts say the\n' +
        '  same, with the GPU pack of the SAME tag. dictationCatalog.test.ts holds the two together.'
    )
  process.exit(1)
}
const buf = Buffer.from(await res.arrayBuffer())

const got = createHash('sha256').update(buf).digest('hex')
if (got !== SHA256)
  fail(
    `SHA-256 mismatch, refusing to unpack\n  expected ${SHA256}\n  got      ${got}` +
      (buf.length !== BYTES
        ? `\n  (${buf.length} bytes, expected ${BYTES}: a cut-off download?)`
        : '')
  )

// Windows' OWN tar, by full path. It is bsdtar (libarchive, in the box since
// Windows 10 1803) and reads zip. A bare `tar` is whatever PATH finds first,
// and under Git Bash, where npm scripts are often run, that is GNU tar, which
// does not: MEASURED, "This does not look like a tar archive".
const TAR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
if (!existsSync(TAR))
  fail(`${TAR} is missing; it is what unpacks the zip (Windows 10 1803 or later)`)

const tmp = mkdtempSync(join(tmpdir(), 'prism-whisper-'))
let taken = 0
// A failure in here THROWS rather than exits: process.exit skips `finally`,
// and the temp folder (the zip plus 22 MB unpacked) would be left behind.
let problem = null
try {
  const zip = join(tmp, ASSET)
  writeFileSync(zip, buf)
  const tree = join(tmp, 'x')
  mkdirSync(tree)
  // argv, never a shell string: both paths may hold spaces.
  execFileSync(TAR, ['-xf', zip, '-C', tree], {
    stdio: ['ignore', 'ignore', 'inherit'],
    windowsHide: true
  })

  // Checked BEFORE anything in <outDir> is touched, so a zip that has changed
  // shape cannot leave half an engine behind a stamp-less folder.
  for (const name of FILES)
    if (!existsSync(join(tree, ZIP_DIR, name)))
      throw new Error(`${ZIP_DIR}/${name} is missing from the archive`)

  mkdirSync(OUT, { recursive: true })
  // <outDir> is the caller's folder, so it is never removed wholesale. What
  // goes is only what a previous pin could have left: an engine DLL that is no
  // longer in FILES would otherwise still be found, and loaded, by ggml.
  for (const old of readdirSync(OUT))
    if (old === '.source' || /^(whisper|ggml|parakeet)[\w.-]*\.(exe|dll)$/i.test(old))
      rmSync(join(OUT, old), { force: true })
  for (const name of FILES) {
    copyFileSync(join(tree, ZIP_DIR, name), join(OUT, name))
    taken++
  }

  // THE C++ RUNTIME TRAVELS WITH THE ENGINE. Every file above imports
  // MSVCP140 / VCRUNTIME140 / VCRUNTIME140_1, and ggml imports VCOMP140
  // (OpenMP); MEASURED from their import tables, and neither official zip
  // carries any of them. They are on most PCs because something else installed
  // the Visual C++ redistributable, which is exactly the kind of luck a
  // product for strangers' machines cannot lean on: without them the server
  // dies at launch with no message. Microsoft licenses these four for
  // APP-LOCAL deployment (a copy beside the exe), so that is what ships.
  // Taken from the BUILD machine, and only if Windows itself vouches for them:
  // a valid Authenticode signature from Microsoft. A build machine without
  // them fails the build here, loudly, rather than shipping an engine that
  // starts only where the developer happens to sit.
  const SYS = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
  // WITHOUT PowerShell 7's MODULE PATH. Started from pwsh (an npm script in a
  // pwsh terminal, and every GitHub Windows runner), Windows PowerShell 5.1
  // inherits PSModulePath, looks for its own Microsoft.PowerShell.Security among
  // 7's modules, and cannot load Get-AuthenticodeSignature at all. MEASURED on a
  // runner, the first time this script ran anywhere but the owner's PC: "the
  // module could not be loaded". Unset, 5.1 falls back to its own defaults.
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'psmodulepath')
  )
  for (const name of RUNTIME) {
    const from = join(SYS, name)
    if (!existsSync(from)) throw new Error(`${from} is missing: install the Visual C++ 2015-2022 x64 redistributable on the build machine`)
    const signer = execFileSync(
      join(SYS, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', '$s = Get-AuthenticodeSignature -LiteralPath $env:PRISM_DLL; "$($s.Status)|$($s.SignerCertificate.Subject)"'],
      { encoding: 'utf8', windowsHide: true, env: { ...cleanEnv, PRISM_DLL: from } }
    ).trim()
    if (!/^Valid\|.*O=Microsoft Corporation/.test(signer)) throw new Error(`${from} is not validly signed by Microsoft (${signer})`)
    copyFileSync(from, join(OUT, name))
    taken++
  }

  // whisper.cpp is MIT, and MIT asks that its notice travel with every copy.
  // The official zip has no licence file in it, so it is fetched from the same
  // tag the binaries were built from.
  const lic = await fetch(`https://raw.githubusercontent.com/ggml-org/whisper.cpp/${TAG}/LICENSE`)
  if (!lic.ok) throw new Error(`the whisper.cpp LICENSE could not be fetched (${lic.status})`)
  writeFileSync(join(OUT, 'LICENSE-whisper.cpp.txt'), await lic.text())
  taken++
  // Last, so the stamp only ever vouches for a complete folder.
  writeFileSync(stamp, SHA256 + '\n')
} catch (e) {
  problem = e?.message ?? String(e)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
if (problem) fail('could not unpack: ' + problem)
console.log(`whisper: unpacked ${taken} files into ${OUT}`)
