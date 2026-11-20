import { join } from 'path'

/**
 * Windows' own programs (reg, where, rundll32, PowerShell, whoami) are started
 * by FULL PATH under %SystemRoot%\System32, never by bare name. A bare name is
 * searched in the folder Prism was started from first, so a file of that name
 * dropped there would run instead of Windows' program (audit #1, 2026-11-20).
 * Every caller goes through here; systemBin.test.ts fails on a bare name.
 */

const system32 = (): string => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')

/** The full path of a System32 program, e.g. systemExe('reg.exe'). */
export function systemExe(name: string): string {
  return join(system32(), name)
}

/** Windows PowerShell 5.1, which lives one folder deeper. */
export function powershellExe(): string {
  return join(system32(), 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}