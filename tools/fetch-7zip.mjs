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
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pinnedDownload, stampHolds, writeStamp } from './lib/pinnedDownload.mjs'
import { ROOT } from './lib/repo.mjs'

const OUT = join(ROOT, 'vendor', '7zip')

const ASSET = '7z2500-x64.msi'
const SHA256 = 'b48e905ed02c530638e6173f2d743668e63561aac1914d2723fbee5690792272'
const URL = `https://www.7-zip.org/a/${ASSET}`
const WANTED = ['7z.exe', '7z.dll', 'License.txt']

if (stampHolds(OUT, '7z.exe', SHA256)) {
  console.log('7-zip: vendor/7zip already holds ' + ASSET)
  process.exit(0)
}

const buf = await pinnedDownload('7-zip', URL, SHA256, { what: ASSET + ' (2 MB)' })

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
writeStamp(OUT, SHA256)
rmSync(work, { recursive: true, force: true })
console.log(`7-zip: unpacked ${WANTED.length} files into vendor/7zip`)
