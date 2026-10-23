import { join } from 'path'

/**
 * WINDOWS' OWN TOOLS, BY THEIR FULL PATH (code review 2026-09-24, #3). A bare
 * name is searched for in the process's CURRENT DIRECTORY before PATH on
 * Windows, and "Open terminal here" starts the app with the clicked folder as
 * its current directory: a downloaded folder holding a `powershell.exe` or a
 * `where.exe` would have had it run by the app within seconds of launch. So
 * every system tool is named by where Windows keeps it, as the dictation
 * store's unzip already did. `SystemRoot` is set on every Windows session;
 * `windir` and the usual folder are the fallbacks.
 */
const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
const system32 = join(root, 'System32')

export const SYS = {
  /** Windows PowerShell 5.1, present on every Windows 10 and 11. */
  powershell: join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  cmd: join(system32, 'cmd.exe'),
  where: join(system32, 'where.exe'),
  wsl: join(system32, 'wsl.exe'),
  reg: join(system32, 'reg.exe')
} as const
