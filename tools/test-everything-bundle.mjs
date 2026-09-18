// Read-only local checks. Privileged lifecycle verification is CI-only below.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, win32 } from 'node:path'

const source = readFileSync('build/indexer/service.ps1', 'utf8')
const planFor = (path) =>
  JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        resolve('build/indexer/service.ps1'),
        '-Action',
        'Plan',
        '-InstallDirectory',
        path
      ],
      { encoding: 'utf8', windowsHide: true }
    )
  )
const location = 'C:\\Users\\Example User\\AppData\\Local\\Programs\\Prism'
const plan = planFor(location)
const id = createHash('sha256').update(location.toLowerCase()).digest('hex').slice(0, 16)
assert.equal(plan.instance, `Prism-${id}`)
assert.equal(plan.pipe, `\\\\.\\PIPE\\Prism Search ${id}`)
assert.equal(plan.installDirectory, location.toLowerCase())
assert.equal(win32.basename(plan.directory), id)
assert.equal(win32.dirname(plan.executable), plan.directory)
assert.notEqual(planFor(location + '-Other').instance, plan.instance)
assert.deepEqual(planFor(location.toUpperCase() + '\\'), plan)
const binaryHash = createHash('sha256')
  .update(readFileSync('vendor/everything/Everything.exe'))
  .digest('hex')
assert.ok(source.includes(binaryHash.toUpperCase()), 'service helper pins bundled executable')
for (const license of ['Everything-LICENSE.txt', 'ES-LICENSE.txt']) {
  assert.match(readFileSync(`vendor/everything/${license}`, 'utf8'), /Permission is hereby granted/)
}
assert.match(
  readFileSync('electron-builder.yml', 'utf8'),
  /from: vendor\/everything\s+to: everything/
)
assert.match(
  readFileSync('build/installer/assoc.nsh', 'utf8'),
  /!insertmacro PRISM_UNINSTALL_INDEXER/
)
assert.match(
  readFileSync('build/installer/pages.nsh', 'utf8'),
  /!insertmacro PRISM_INSTALL_INDEXER/
)
assert.match(
  execFileSync('vendor/everything/es.exe', ['-version'], { encoding: 'utf8', windowsHide: true }),
  /1\.1\.0\.38/
)
console.log(
  'Bundled indexer: pinned binaries, licenses, installation identity and NSIS hooks passed'
)
