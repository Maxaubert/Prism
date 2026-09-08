// Fetch the ffmpeg Prism bundles, at build time, into vendor/ffmpeg.
//
// Chromium ships no Dolby Digital (AC-3/E-AC-3), DTS or TrueHD decoder, so a
// large slice of ordinary MKV rips play with picture and no sound. Prism
// decodes those tracks itself by piping the file through ffmpeg (see
// src/main/audioSidecar.ts), which means shipping one.
//
// The build is BtbN's LGPL SHARED build, pinned by release tag and verified by
// SHA-256. Shared, not static, on purpose: LGPL's relink clause is satisfied
// by DLLs the user can replace. The GPL builds are deliberately not used - AC-3,
// E-AC-3, DTS and TrueHD DECODERS are all LGPL, so the GPL half buys us nothing.
//
// The binaries are NOT committed: this script is what a fresh clone (and CI)
// runs before packaging. Re-running is free once vendor/ffmpeg is populated.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'vendor', 'ffmpeg')

const TAG = 'autobuild-2026-09-07-15-39'
const ASSET = 'ffmpeg-n9.0.1-27-g9b0578816c-win64-lgpl-shared-9.0.zip'
const SHA256 = '8418fb932d233da1b889a193deff053e9b90e954425a0d3d197c5a72bff12ff8'
const URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${TAG}/${ASSET}`

// ffmpeg.exe imports all of these at load time, so "only what we use" is not a
// choice we get to make. ffplay.exe (18MB of SDL video player) is skipped.
const WANTED = [
  'bin/ffmpeg.exe',
  'bin/ffprobe.exe',
  'bin/avcodec-63.dll',
  'bin/avdevice-63.dll',
  'bin/avfilter-12.dll',
  'bin/avformat-63.dll',
  'bin/avutil-61.dll',
  'bin/swresample-7.dll',
  'bin/swscale-10.dll',
  'LICENSE.txt'
]

const stamp = join(OUT, '.source')
if (existsSync(join(OUT, 'ffmpeg.exe')) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === SHA256) {
  console.log('ffmpeg: vendor/ffmpeg already holds ' + ASSET)
  process.exit(0)
}

console.log('ffmpeg: downloading ' + ASSET + ' (67 MB)')
const res = await fetch(URL)
if (!res.ok) {
  console.error(`ffmpeg: download failed (${res.status} ${res.statusText})\n  ${URL}`)
  // A 404 here is almost never a broken machine: BtbN's autobuild releases
  // are ROTATED, and a tag that existed when this was pinned is deleted a few
  // weeks later (measured: the 2026-08-23 build was gone by 2026-09-08, and
  // took a release build down with it). The pin is deliberate, so the fix is
  // to re-pin rather than to follow `latest` and lose the checksum.
  if (res.status === 404)
    console.error(
      'ffmpeg: that build has been rotated away upstream. Re-pin TAG, ASSET and SHA256 above from\n' +
        '  https://github.com/BtbN/FFmpeg-Builds/releases (the win64-lgpl-shared zip of the same 9.0 line)'
    )
  process.exit(1)
}
const buf = Buffer.from(await res.arrayBuffer())

const got = createHash('sha256').update(buf).digest('hex')
if (got !== SHA256) {
  console.error(`ffmpeg: SHA-256 mismatch, refusing to unpack\n  expected ${SHA256}\n  got      ${got}`)
  process.exit(1)
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const zip = new AdmZip(buf)
// Every entry sits under one top-level folder named after the build.
const entries = zip.getEntries()
let taken = 0
for (const want of WANTED) {
  const hit = entries.find((e) => e.entryName.endsWith('/' + want))
  if (!hit) {
    console.error('ffmpeg: ' + want + ' is missing from the archive')
    process.exit(1)
  }
  // Flattened: bin/x.dll and LICENSE.txt all land beside each other, which is
  // what electron-builder copies to resources/bin and what the resolver expects.
  writeFileSync(join(OUT, want.split('/').pop()), hit.getData())
  taken++
}
writeFileSync(stamp, SHA256 + '\n')
console.log(`ffmpeg: unpacked ${taken} files into vendor/ffmpeg`)
