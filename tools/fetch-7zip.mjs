// Fetch the 7-Zip Prism bundles, at build time, into vendor/7zip.
//
// zip is handled in-process by adm-zip (and stays that way, because Prism
// WRITES zips). Everything else - 7z, rar, tar, gz, bz2, xz, iso, cab - is
// read through 7-Zip's own binary, which is the only free thing that reads
// modern rar at all.
//
// The download is the official MSI, pinned by name and verified by SHA-256,
// then unpacked with `msiexec /a` (an administrative install, which just
// expands the files - no elevation, nothing registered, nothing installed).
// 7z.exe alone cannot read rar; the format handlers live in 7z.dll, so both
// ship, along with the licence.
//
// The binaries are NOT committed: this script is what a fresh clone (and CI)
// runs before packaging.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'vendor', '7zip')

const ASSET = '7z2500-x64.msi'
const SHA256 = 'b48e905ed02c530638e6173f2d743668e63561aac1914d2723fbee5690792272'
const URL = `https://www.7-zip.org/a/${ASSET}`
const WANTED = ['7z.exe', '7z.dll', 'License.txt']

const stamp = join(OUT, '.source')
if (existsSync(join(OUT, '7z.exe')) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === SHA256) {
  console.log('7-zip: vendor/7zip already holds ' + ASSET)
  process.exit(0)
}

console.log('7-zip: downloading ' + ASSET + ' (2 MB)')
const res = await fetch(URL)
if (!res.ok) {
  console.error(`7-zip: download failed (${res.status} ${res.statusText})\n  ${URL}`)
  process.exit(1)
}
const buf = Buffer.from(await res.arrayBuffer())
const got = createHash('sha256').update(buf).digest('hex')
if (got !== SHA256) {
  console.error(`7-zip: SHA-256 mismatch, refusing to unpack\n  expected ${SHA256}\n  got      ${got}`)
  process.exit(1)
}

const work = join(tmpdir(), 'prism-7zip-' + process.pid)
const msi = join(work, ASSET)
mkdirSync(work, { recursive: true })
writeFileSync(msi, buf)

// /a expands the package into TARGETDIR. /qn keeps it silent; no elevation.
const r = spawnSync('msiexec', ['/a', msi, `TARGETDIR=${join(work, 'x')}`, '/qn'], { windowsHide: true })
if (r.status !== 0) {
  console.error('7-zip: msiexec could not expand the package (exit ' + r.status + ')')
  process.exit(1)
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const from = join(work, 'x', 'Files', '7-Zip')
for (const name of WANTED) {
  const src = join(from, name)
  if (!existsSync(src)) {
    console.error('7-zip: ' + name + ' is missing from the package')
    process.exit(1)
  }
  copyFileSync(src, join(OUT, name))
}
writeFileSync(stamp, SHA256 + '\n')
rmSync(work, { recursive: true, force: true })
console.log(`7-zip: unpacked ${WANTED.length} files into vendor/7zip`)
