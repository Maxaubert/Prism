// The .NET Framework C# compiler every Windows machine carries: the route the
// Win+E helper (build-win-e) and the DWM helper (build-dwm) are built by.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ROOT } from './repo.mjs'

export function cscPath() {
  const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  if (!existsSync(compiler)) throw new Error('The Windows .NET Framework C# compiler is unavailable')
  return compiler
}

/** Compile one .cs into `out` (x64, optimised, warnings as errors), with
 *  csc's own `target` (winexe: no console window flashes up). Returns the
 *  exit status; a compiler that could not start throws. */
export function compileCs({ src, out, target = 'winexe', references = [] }) {
  const compiler = cscPath()
  mkdirSync(dirname(out), { recursive: true })
  const result = spawnSync(
    compiler,
    [
      '/nologo',
      `/target:${target}`,
      '/platform:x64',
      '/optimize+',
      '/warnaserror+',
      ...references.map((r) => `/reference:${r}`),
      `/out:${out}`,
      src
    ],
    { cwd: ROOT, stdio: 'inherit', windowsHide: true }
  )
  if (result.error) throw result.error
  return result.status ?? 1
}
