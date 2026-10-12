// Build-time only. Both the indexing engine and its IPC client are bundled;
// end users never need to download or configure a separate Everything install.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { pinnedDownload, sha256Of as digest } from './lib/pinnedDownload.mjs'
import { ROOT as root } from './lib/repo.mjs'

const output = join(root, 'vendor', 'everything')
const assets = [
  {
    name: 'Everything-1.4.1.1032.x64.zip',
    sha256: '698df475ec44e638f66f1b6a32d28fea613cec78d3b6310e6abe53431eeb940c',
    files: { 'everything.exe': 'Everything.exe', 'Everything.lng': 'Everything.lng' }
  },
  {
    name: 'ES-1.1.0.38.x64.zip',
    sha256: '5e0c70cbf4f694080c34aa7c6c745e606c16fe76a4b5423b93ebf9dc34274c99',
    files: { 'es.exe': 'es.exe' }
  }
]
mkdirSync(output, { recursive: true })
const stampPath = join(output, '.source')
let previous = {}
try {
  previous = JSON.parse(readFileSync(stampPath, 'utf8'))
} catch {
  /* first build */
}
const manifest = { assets: assets.map(({ name, sha256 }) => ({ name, sha256 })), files: {} }
for (const asset of assets) {
  const valid =
    previous.assets?.some((a) => a.name === asset.name && a.sha256 === asset.sha256) &&
    Object.values(asset.files).every(
      (name) =>
        existsSync(join(output, name)) &&
        digest(readFileSync(join(output, name))) === previous.files?.[name]
    )
  if (!valid) {
    const archive = await pinnedDownload('Everything', `https://www.voidtools.com/${asset.name}`, asset.sha256, {
      what: `pinned ${asset.name}`
    })
    const zip = new AdmZip(archive)
    // Extract only explicitly named entries, never archive-controlled paths.
    for (const [entry, name] of Object.entries(asset.files)) {
      const data = zip.readFile(entry)
      if (!data) throw new Error(`Missing ${entry} in ${asset.name}`)
      writeFileSync(join(output, name), data)
    }
  }
  for (const name of Object.values(asset.files))
    manifest.files[name] = digest(readFileSync(join(output, name)))
}
for (const name of ['Everything-LICENSE.txt', 'ES-LICENSE.txt', 'NOTICE.txt', 'service.ps1']) {
  copyFileSync(join(root, 'build', 'indexer', name), join(output, name))
}
writeFileSync(stampPath, JSON.stringify(manifest, null, 2) + '\n')
console.log('Everything: stable engine 1.4.1.1032 and ES 1.1.0.38 ready in vendor/everything')
