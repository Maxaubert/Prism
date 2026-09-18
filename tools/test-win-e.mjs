import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'win32') {
  console.log('Win+E helper: native tests require Windows')
  process.exit(0)
}
for (const [command, args] of [
  [process.execPath, [join(root, 'tools', 'build-win-e.mjs')]],
  [join(root, 'vendor', 'win-e', 'PrismShortcut.exe'), ['--self-test']]
]) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 30000 })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
