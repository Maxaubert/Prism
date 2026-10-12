// Builds vendor/dwm/PrismDwm.exe from native/dwm/PrismDwm.cs (#189), with the
// .NET Framework C# compiler every Windows machine carries - the same route as
// the Win+E helper (tools/build-win-e.mjs, both through tools/lib/csc.mjs).
// Then runs its self-test, so a helper that cannot start is a failed build and
// not a window with the wrong border.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { compileCs } from './lib/csc.mjs'
import { ROOT, windowsOnly } from './lib/repo.mjs'

windowsOnly('DWM helper: Windows-only build skipped')
const exe = join(ROOT, 'vendor', 'dwm', 'PrismDwm.exe')
// winexe: no console window flashes up on every border change.
const status = compileCs({ src: join(ROOT, 'native', 'dwm', 'PrismDwm.cs'), out: exe })
if (status !== 0) process.exit(status)
const test = spawnSync(exe, ['--self-test'], { windowsHide: true })
if (test.error) throw test.error
if (test.status !== 0) {
  console.error(`DWM helper self-test failed (exit ${test.status})`)
  process.exit(1)
}
console.log('DWM helper: built and self-tested')
