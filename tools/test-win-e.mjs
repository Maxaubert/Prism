import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT, windowsOnly } from './lib/repo.mjs'

windowsOnly('Win+E helper: native tests require Windows')
for (const [command, args] of [
  [process.execPath, [join(ROOT, 'tools', 'build-win-e.mjs')]],
  [join(ROOT, 'vendor', 'win-e', 'PrismShortcut.exe'), ['--self-test']]
]) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true, timeout: 30000 })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
