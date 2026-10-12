// Visual Studio's C++ tools, found through vswhere: the native sweep addon
// (build-sweep) and the sweep-latency tool both need them.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** The newest Visual Studio with the x64 C++ tools, or null. */
export function vsInstallPath() {
  const vswhere = join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe'
  )
  if (!existsSync(vswhere)) return null
  const found = spawnSync(
    vswhere,
    ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
    { encoding: 'utf8', windowsHide: true }
  )
  return (found.stdout ?? '').trim().split(/\r?\n/)[0] || null
}

/** vcvars64.bat, which sets cl up for one cmd line, or null. */
export function vcvars64() {
  const vs = vsInstallPath()
  const bat = vs ? join(vs, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat') : null
  return bat && existsSync(bat) ? bat : null
}

/** The newest MSVC's dumpbin.exe, or null. */
export function dumpbinPath() {
  const vs = vsInstallPath()
  if (!vs) return null
  const msvc = join(vs, 'VC', 'Tools', 'MSVC')
  if (!existsSync(msvc)) return null
  for (const v of readdirSync(msvc).sort().reverse()) {
    const exe = join(msvc, v, 'bin', 'Hostx64', 'x64', 'dumpbin.exe')
    if (existsSync(exe)) return exe
  }
  return null
}
