import { describe, expect, it } from 'vitest'
import { cdCommand, decideFollow, parseOsc9 } from './termCwd'

describe('parseOsc9', () => {
  it('reads the Windows Terminal cwd report, quoted or not', () => {
    expect(parseOsc9('9;C:\\Users\\me\\proj')).toBe('C:\\Users\\me\\proj')
    expect(parseOsc9('9;"C:\\Users\\me\\proj"')).toBe('C:\\Users\\me\\proj')
    expect(parseOsc9('9;\\\\srv\\share\\x')).toBe('\\\\srv\\share\\x')
  })

  it('refuses anything that is not a report of a Windows folder', () => {
    expect(parseOsc9('4;100;50')).toBeNull() // ConEmu progress, same OSC number
    expect(parseOsc9('9;')).toBeNull()
    expect(parseOsc9('9;Cert:\\LocalMachine')).toBeNull()
    expect(parseOsc9('9;/home/me')).toBeNull()
  })
})

describe('decideFollow', () => {
  const root = 'C:\\work\\Prism'
  it('tells the root, a folder inside it and a folder past the wall apart', () => {
    expect(decideFollow(root, 'c:\\WORK\\prism')).toBe('same')
    expect(decideFollow(root, 'C:\\work\\Prism\\')).toBe('same')
    expect(decideFollow(root, 'C:\\work\\Prism\\src\\main')).toBe('inside')
    expect(decideFollow(root, 'C:\\work\\Prism2')).toBe('outside') // a same-prefixed sibling
    expect(decideFollow(root, 'C:\\work')).toBe('outside')
    expect(decideFollow(root, 'D:\\')).toBe('outside')
  })
})

describe('cdCommand', () => {
  it('writes Set-Location for the PowerShells, quoting the one character that needs it', () => {
    expect(cdCommand('pwsh', "C:\\it's\\here")).toBe("Set-Location -LiteralPath 'C:\\it''s\\here'\r")
    expect(cdCommand('powershell', 'C:\\a b')).toBe("Set-Location -LiteralPath 'C:\\a b'\r")
  })

  it('writes cd /d for cmd, so a drive change works', () => {
    expect(cdCommand('cmd', 'D:\\a b')).toBe('cd /d "D:\\a b"\r')
  })

  it('writes nothing for shells it does not know how to move', () => {
    expect(cdCommand('wsl-Ubuntu', 'C:\\x')).toBeNull()
    expect(cdCommand(undefined, 'C:\\x')).toBeNull()
    expect(cdCommand('pwsh', '')).toBeNull()
  })
})
