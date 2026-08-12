import { describe, expect, it } from 'vitest'
import { argsFor, mruOrder, parseRegOutput, splitCommandLine } from './openWith'

const REG_SAMPLE = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\OpenWithList',
  '    a    REG_SZ    Code.exe',
  '    b    REG_SZ    notepad.exe',
  '    MRUList    REG_SZ    ba',
  ''
].join('\r\n')

describe('parseRegOutput', () => {
  it('reads value rows under their key', () => {
    const v = parseRegOutput(REG_SAMPLE)
    expect(v).toHaveLength(3)
    expect(v[0]).toMatchObject({ name: 'a', type: 'REG_SZ', data: 'Code.exe' })
    expect(v[0].key).toMatch(/OpenWithList$/)
  })

  it('reads default values and data with spaces', () => {
    const v = parseRegOutput(
      'HKEY_CLASSES_ROOT\\Applications\\Code.exe\\shell\\open\\command\r\n' +
        '    (Default)    REG_SZ    "C:\\Program Files\\VS Code\\Code.exe" "%1"\r\n'
    )
    expect(v[0].name).toBe('(Default)')
    expect(v[0].data).toBe('"C:\\Program Files\\VS Code\\Code.exe" "%1"')
  })

  it('survives empty output', () => {
    expect(parseRegOutput('')).toEqual([])
  })
})

describe('splitCommandLine', () => {
  it('honours quotes around paths with spaces', () => {
    expect(splitCommandLine('"C:\\Program Files\\App\\app.exe" --open "%1"')).toEqual([
      'C:\\Program Files\\App\\app.exe',
      '--open',
      '%1'
    ])
  })
  it('splits unquoted tokens', () => {
    expect(splitCommandLine('C:\\Windows\\notepad.exe %1')).toEqual([
      'C:\\Windows\\notepad.exe',
      '%1'
    ])
  })
})

describe('argsFor', () => {
  it('substitutes %1 and %L', () => {
    expect(argsFor(['app.exe', '--open', '%1'], 'C:\\f\\a.md')).toEqual(['--open', 'C:\\f\\a.md'])
    expect(argsFor(['app.exe', '%L'], 'C:\\f\\a.md')).toEqual(['C:\\f\\a.md'])
  })
  it('appends the file when the template never mentions it', () => {
    expect(argsFor(['app.exe', '--new-window'], 'C:\\f\\a.md')).toEqual([
      '--new-window',
      'C:\\f\\a.md'
    ])
  })
})

describe('mruOrder', () => {
  it('orders by MRUList, then whatever is left', () => {
    const v = parseRegOutput(REG_SAMPLE)
    expect(mruOrder(v)).toEqual(['notepad.exe', 'Code.exe'])
  })
  it('copes with no MRUList', () => {
    const v = parseRegOutput(
      'HKEY\\X\\OpenWithList\r\n    a    REG_SZ    one.exe\r\n    b    REG_SZ    two.exe\r\n'
    )
    expect(mruOrder(v)).toEqual(['one.exe', 'two.exe'])
  })
})
