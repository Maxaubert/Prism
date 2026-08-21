import { beforeEach, describe, expect, it } from 'vitest'
import { agentIndicator, customTermTheme, saveCustomTermTheme, setAgentIndicator, setTermFontPct, setTermThemeId, termBaseFontPx, termFontPct, termThemeId } from './termLook'

beforeEach(() => localStorage.clear())

describe('terminal look prefs', () => {
  it('defaults: follow the style, 100% of 13px', () => {
    expect(termThemeId()).toBe('style')
    expect(termFontPct()).toBe(100)
    expect(termBaseFontPx()).toBe(13)
  })
  it('round-trips a preset and a size', () => {
    setTermThemeId('dracula')
    setTermFontPct(125)
    expect(termThemeId()).toBe('dracula')
    expect(termFontPct()).toBe(125)
    expect(termBaseFontPx()).toBe(16)
  })
  it('an off-menu percentage falls back to 100', () => {
    localStorage.setItem('prism.term.fontPct', '733')
    expect(termFontPct()).toBe(100)
  })
})

describe('the one custom theme', () => {
  it('is null before any save, and saving overwrites the single slot', () => {
    expect(customTermTheme()).toBeNull()
    saveCustomTermTheme({ bg: '#111111', fg: '#eeeeee', cursor: '#ff0000', ansi: { red: '#ff5555' } })
    expect(customTermTheme()?.bg).toBe('#111111')
    saveCustomTermTheme({ bg: '#222222', fg: '#dddddd', cursor: '#00ff00', ansi: {} })
    expect(customTermTheme()?.bg).toBe('#222222')
  })
  it('a corrupt save reads as no custom theme', () => {
    localStorage.setItem('prism.term.custom', '{nope')
    expect(customTermTheme()).toBeNull()
  })
})

describe('the agent indicator', () => {
  it('defaults to full and round-trips minimal', () => {
    expect(agentIndicator()).toBe('full')
    setAgentIndicator('minimal')
    expect(agentIndicator()).toBe('minimal')
  })
  it('garbage reads as the default', () => {
    localStorage.setItem('prism.term.agentIndicator', 'soup')
    expect(agentIndicator()).toBe('full')
  })
})
