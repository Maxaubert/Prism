import { describe, expect, it } from 'vitest'
import { titleState } from './agentTitle'

describe('titleState (Claude Code writes its state into the terminal title)', () => {
  it('reads working from any of the four spinner glyphs', () => {
    for (const g of ['◐', '◑', '◒', '◓']) expect(titleState(`${g} Claude Code`)).toBe('working')
    expect(titleState('◑ Create and read note.txt')).toBe('working')
  })

  it('reads idle from the asterisk, at birth and after an answer', () => {
    expect(titleState('✳ Claude Code')).toBe('idle')
    expect(titleState('✳ Session greeting')).toBe('idle')
    expect(titleState('  ✳ padded')).toBe('idle')
  })

  it('is null for every other title: the shell, a command, a path', () => {
    expect(titleState('claude')).toBeNull()
    expect(titleState('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBeNull()
    expect(titleState('')).toBeNull()
    expect(titleState('* not the glyph')).toBeNull()
  })
})
