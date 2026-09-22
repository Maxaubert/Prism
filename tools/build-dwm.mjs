// Builds vendor/dwm/PrismDwm.exe from native/dwm/PrismDwm.cs (#189), with the
// .NET Framework C# compiler every Windows machine carries - the same route as
// the Win+E helper (tools/build-win-e.mjs). Then runs its self-test, so a helper
// that cannot start is a failed build and not a window with the wrong border.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'win32') {
  console.log('DWM helper: Windows-only build skipped')
  process.exit(0)
}
const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
if (!existsSync(compiler)) throw new Error('The Windows .NET Framework C# compiler is unavailable')
const output = join(root, 'vendor', 'dwm')
mkdirSync(output, { recursive: true })
const exe = join(output, 'PrismDwm.exe')
// winexe: no console window flashes up on every border change.
const built = spawnSync(
  compiler,
  ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/warnaserror+', `/out:${exe}`, join(root, 'native', 'dwm', 'PrismDwm.cs')],
  { cwd: root, stdio: 'inherit', windowsHide: true }
)
if (built.error) throw built.error
if (built.status !== 0) process.exit(built.status ?? 1)
const test = spawnSync(exe, ['--self-test'], { windowsHide: true })
if (test.error) throw test.error
if (test.status !== 0) {
  console.error(`DWM helper self-test failed (exit ${test.status})`)
  process.exit(1)
}
console.log('DWM helper: built and self-tested')
