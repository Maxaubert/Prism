import { beforeEach, describe, expect, it } from 'vitest'
import { setTermFontPct, setTermThemeId, termBaseFontPx, termFontPct, termThemeId } from './termLook'

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
