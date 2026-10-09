// Builds tools/sweep-latency/build/sweep-latency.exe (#338, task 1 step 3):
// MSVC through vswhere and vcvars64, /MT so it runs on any machine. Dev-only;
// the measuring tool is never shipped.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
if (process.platform !== 'win32') {
  console.log('sweep-latency: Windows only')
  process.exit(0)
}
const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
if (!existsSync(vswhere)) throw new Error('vswhere.exe not found: install the Visual Studio C++ build tools')
const found = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' })
const vs = found.stdout.trim().split(/\r?\n/)[0]
const vcvars = join(vs, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
if (!vs || !existsSync(vcvars)) throw new Error('MSVC x64 tools not found')
const out = join(here, 'build')
mkdirSync(out, { recursive: true })
const cmd = `call "${vcvars}" >nul && cl /nologo /O2 /MT /EHsc /std:c++17 /W4 /utf-8 "${join(here, 'latency.cpp')}" /Fo"${out}\\\\" /Fe"${join(out, 'sweep-latency.exe')}"`
const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], { stdio: 'inherit', windowsHide: true, windowsVerbatimArguments: true })
if (r.status !== 0) process.exit(r.status ?? 1)
console.log(`sweep-latency: built ${join(out, 'sweep-latency.exe')}`)
