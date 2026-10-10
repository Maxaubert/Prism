// Builds vendor/sweep/prism_sweep.node from native/sweep (#338), the native
// sweep box, with node-gyp and MSVC, after tools/build-dwm.mjs. Then checks
// what a fresh Windows would need to load it and runs its self-test, so an
// addon that cannot load is a failed build and not a Prism that quietly keeps
// the DOM box.
//
// - The target is the Node version THIS Electron embeds (asked of the Electron
//   binary itself), so the build machine's own Node does not matter. node-gyp
//   fetches that version's headers and node.lib from nodejs.org on a cold
//   cache: build time only, never at run time.
// - /MT (binding.gyp): `dumpbin /dependents` must name only the allow-list
//   below. Any VCRUNTIME*, MSVCP* or api-ms-win-crt-* (the VC++
//   redistributable) fails the build. node.exe is the delay-loaded import
//   node-gyp's win_delay_load_hook redirects to the host exe.
// - Then it is loaded in plain Node: selfTest() runs box.h's cases and must
//   come back empty, and probe() must answer.
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'win32') {
  console.log('Sweep addon: Windows-only build skipped')
  process.exit(0)
}
const require = createRequire(import.meta.url)
const src = join(root, 'native', 'sweep')
const built = join(src, 'build', 'Release', 'prism_sweep.node')
const outDir = join(root, 'vendor', 'sweep')
const out = join(outDir, 'prism_sweep.node')
const ALLOWED = new Set(['kernel32.dll', 'user32.dll', 'd3d11.dll', 'dxgi.dll', 'dcomp.dll', 'node.exe'])

function fail(message) {
  console.error(`Sweep addon: ${message}`)
  process.exit(1)
}

// 1. The Node version Electron embeds.
const electronExe = require('electron')
const nodeVersion = execFileSync(electronExe, ['-p', 'process.versions.node'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  windowsHide: true
}).trim()
if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) fail(`could not read Electron's Node version (${nodeVersion})`)

// 2. node-gyp, against that version.
const gyp = join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
if (!existsSync(gyp)) fail('node-gyp is missing: run npm ci')
const make = spawnSync(
  process.execPath,
  [gyp, 'rebuild', `--target=${nodeVersion}`, '--arch=x64', `--directory=${src}`],
  { cwd: root, stdio: 'inherit', windowsHide: true }
)
if (make.error) throw make.error
if (make.status !== 0) process.exit(make.status ?? 1)
if (!existsSync(built)) fail(`node-gyp left no ${built}`)
mkdirSync(outDir, { recursive: true })
copyFileSync(built, out)

// 3. What it imports: system DLLs only.
function findDumpbin() {
  const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!existsSync(vswhere)) return null
  const vs = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], {
    encoding: 'utf8',
    windowsHide: true
  }).stdout.trim().split(/\r?\n/)[0]
  if (!vs) return null
  const msvc = join(vs, 'VC', 'Tools', 'MSVC')
  if (!existsSync(msvc)) return null
  for (const v of readdirSync(msvc).sort().reverse()) {
    const exe = join(msvc, v, 'bin', 'Hostx64', 'x64', 'dumpbin.exe')
    if (existsSync(exe)) return exe
  }
  return null
}
const dumpbin = findDumpbin()
if (!dumpbin) fail('dumpbin.exe not found (Visual Studio C++ build tools)')
const deps = execFileSync(dumpbin, ['/nologo', '/dependents', out], { encoding: 'utf8', windowsHide: true })
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => /\.(dll|exe)$/i.test(l) && !l.includes('\\') && !l.includes(':'))
if (!deps.length) fail('dumpbin listed no dependencies; its output changed?')
const stray = deps.filter((d) => !ALLOWED.has(d.toLowerCase()))
if (stray.length) fail(`imports outside the allow-list: ${stray.join(', ')} (is it still /MT?)`)

// 4. Load it in plain Node and run its self-test.
const mod = { exports: {} }
process.dlopen(mod, out)
const failures = mod.exports.selfTest()
if (!Array.isArray(failures)) fail('selfTest() did not return a list')
if (failures.length) fail(`self-test failed:\n  ${failures.join('\n  ')}`)
const probe = mod.exports.probe()
if (typeof probe?.build !== 'number' || typeof probe?.clock !== 'boolean') fail('probe() answered nothing usable')
console.log(
  `Sweep addon: built for Node ${nodeVersion}, imports ${deps.join(', ')}, self-test passed (Windows build ${probe.build}, compositor clock ${probe.clock ? 'yes' : 'no'})`
)
