import { describe, expect, it } from 'vitest'
import { parseWslList, shellById, type ShellDef } from './shells'

const L: ShellDef[] = [
  { id: 'pwsh', name: 'PowerShell 7', exe: 'pwsh.exe', args: ['-NoLogo'] },
  { id: 'powershell', name: 'Windows PowerShell', exe: 'powershell.exe', args: ['-NoLogo'] },
  { id: 'cmd', name: 'Command Prompt', exe: 'cmd.exe', args: [] }
]

describe('parseWslList', () => {
  it('reads decoded output with blank lines and CRLF', () => {
    expect(parseWslList('Ubuntu\r\n\r\nDebian\r\n')).toEqual(['Ubuntu', 'Debian'])
  })
  it('is empty for no distros or an error banner', () => {
    expect(parseWslList('')).toEqual([])
    // The banner has spaces, which no distro name in -q output does.
    expect(parseWslList('Windows Subsystem for Linux has no installed distributions.')).toEqual([])
  })
  it('keeps dots and dashes in distro names', () => {
    expect(parseWslList('Ubuntu-22.04\r\nopenSUSE-Leap-15.6\r\n')).toEqual([
      'Ubuntu-22.04',
      'openSUSE-Leap-15.6'
    ])
  })
})

describe('shellById', () => {
  it('finds the saved shell', () => {
    expect(shellById('cmd', L).id).toBe('cmd')
  })
  it('falls back to pwsh when the saved shell is gone', () => {
    expect(shellById('wsl-Arch', L).id).toBe('pwsh')
    expect(shellById(undefined, L).id).toBe('pwsh')
  })
  it('falls back to powershell when pwsh is absent too', () => {
    expect(shellById('x', L.slice(1)).id).toBe('powershell')
  })
})
