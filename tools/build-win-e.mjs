import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'win32') {
  console.log('Win+E helper: Windows-only build skipped')
  process.exit(0)
}
const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
if (!existsSync(compiler)) throw new Error('The Windows .NET Framework C# compiler is unavailable')
const output = join(root, 'vendor', 'win-e')
mkdirSync(output, { recursive: true })
const result = spawnSync(compiler, [
  '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/warnaserror+',
  '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
  `/out:${join(output, 'PrismShortcut.exe')}`,
  join(root, 'native', 'win-e', 'PrismShortcut.cs')
], { cwd: root, stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exit(result.status ?? 1)
