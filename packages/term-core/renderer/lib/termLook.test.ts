import { beforeEach, describe, expect, it } from 'vitest'
import { FONT_PCTS, agentColorChoice, agentDoneColorChoice, agentQuestionColorChoice, setAgentDoneColor, setAgentQuestionColor, termGroundAlpha, applyCustomExtras, resetTermExtras, agentIndicator, customTermTheme, setAgentColor, saveCustomTermTheme, setAgentIndicator, setTermAcrylic, setTermFontPct, setTermThemeId, termAcrylic, termBaseFontPx, termExtraDefaults, termFontPct, termThemeId } from './termLook'
import * as termLook from './termLook'

beforeEach(() => localStorage.clear())

describe('terminal look prefs', () => {
  it('defaults: the prism preset, 100% of 13px', () => {
    expect(termThemeId()).toBe('prism')
    expect(termFontPct()).toBe(100)
    expect(termBaseFontPx()).toBe(13)
  })
  it('round-trips a preset and a size', () => {
    setTermThemeId('dracula')
    setTermFontPct(120)
    expect(termThemeId()).toBe('dracula')
    expect(termFontPct()).toBe(120)
    expect(termBaseFontPx()).toBe(16)
  })
  it("a stored 'style' (Prism's follow-the-app default) reads as prism", () => {
    localStorage.setItem('prism.term.theme', 'style')
    expect(termThemeId()).toBe('prism')
  })
  it('an off-menu percentage falls back to 100', () => {
    localStorage.setItem('prism.term.fontPct', '733')
    expect(termFontPct()).toBe(100)
    localStorage.setItem('prism.term.fontPct', '20')
    expect(termFontPct()).toBe(100)
  })
  it('the sizes run 50 to 200 in tens, and an old step lands on the nearest', () => {
    expect(FONT_PCTS[0]).toBe(50)
    expect(FONT_PCTS[FONT_PCTS.length - 1]).toBe(200)
    expect(FONT_PCTS.every((p, i) => i === 0 || p - FONT_PCTS[i - 1] === 10)).toBe(true)
    localStorage.setItem('prism.term.fontPct', '125')
    expect(termFontPct()).toBe(130)
    localStorage.setItem('prism.term.fontPct', '175')
    expect(termFontPct()).toBe(180)
    localStorage.setItem('prism.term.fontPct', '60')
    expect(termFontPct()).toBe(60)
  })
  it('a theme leaves the font and its size alone', () => {
    localStorage.setItem('prism.term.font', 'consolas')
    localStorage.setItem('prism.term.fontPct', '140')
    resetTermExtras()
    applyCustomExtras({ bg: '#000000', fg: '#ffffff', cursor: '#ff0000', ansi: {}, font: 'cascadia', fontPct: 90 })
    expect(localStorage.getItem('prism.term.font')).toBe('consolas')
    expect(termFontPct()).toBe(140)
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
  it('defaults to minimal and round-trips full', () => {
    localStorage.removeItem('prism.term.agentIndicator')
    expect(agentIndicator()).toBe('minimal')
    setAgentIndicator('full')
    expect(agentIndicator()).toBe('full')
  })
  it('garbage reads as the default', () => {
    localStorage.setItem('prism.term.agentIndicator', 'soup')
    expect(agentIndicator()).toBe('minimal')
  })
})

describe('the working colour', () => {
  it('follows the theme until a colour is picked, and can be given back', () => {
    localStorage.removeItem('prism.term.agentColor')
    expect(agentColorChoice()).toBe('')
    setAgentColor('#22c55e')
    expect(agentColorChoice()).toBe('#22c55e')
    setAgentColor('')
    expect(agentColorChoice()).toBe('')
    expect(localStorage.getItem('prism.term.agentColor')).toBeNull()
  })
  it('garbage in storage reads as following the theme', () => {
    localStorage.setItem('prism.term.agentColor', 'soup')
    expect(agentColorChoice()).toBe('')
  })
})

describe('acrylic, and the opacity it no longer has', () => {
  it('acrylic is off until asked for', () => {
    expect(termAcrylic()).toBe(false)
    setTermAcrylic(true)
    expect(termAcrylic()).toBe(true)
  })
  it('nothing writes an opacity any more, and no theme carries one', () => {
    expect('setTermOpacity' in termLook).toBe(false)
    expect('termOpacity' in termLook).toBe(false)
    expect('opacity' in termExtraDefaults()).toBe(false)
    applyCustomExtras({ bg: '#000000', fg: '#ffffff', cursor: '#ff0000', ansi: {}, acrylic: true, opacity: 60 } as never)
    expect(localStorage.getItem('prism.term.opacity')).toBeNull()
  })
})

// #112: alpha on every colour. Every reader takes 6 or 8 digits; a bad value
// reads as absent; what is stored is the one canonical form.
describe('colours with alpha', () => {
  it('the three agent colours accept hex8 and refuse 7 or 9 digits', () => {
    setAgentColor('#22c55e80')
    expect(agentColorChoice()).toBe('#22c55e80')
    setAgentDoneColor('#22C55E80')
    expect(agentDoneColorChoice()).toBe('#22c55e80')
    setAgentQuestionColor('#3b82f6cc')
    expect(agentQuestionColorChoice()).toBe('#3b82f6cc')
    for (const bad of ['#22c55e8', '#22c55e800']) {
      localStorage.setItem('prism.term.agentColor', bad)
      expect(agentColorChoice()).toBe('')
    }
  })
  it('a picked opaque colour is stored exactly as it always was', () => {
    setAgentColor('#22c55e')
    expect(localStorage.getItem('prism.term.agentColor')).toBe('#22c55e')
  })
  it('the custom theme drops a bad ANSI value and keeps the rest', () => {
    localStorage.setItem(
      'prism.term.custom',
      JSON.stringify({ bg: '#111111', fg: '#EEEEEE', cursor: '#ff000080', selection: '#33445566', ansi: { red: '#ff5555', green: 'soup', blue: '#0000ff40' } })
    )
    const c = customTermTheme()
    expect(c?.fg).toBe('#eeeeee')
    expect(c?.cursor).toBe('#ff000080')
    expect(c?.selection).toBe('#33445566')
    expect(c?.ansi).toEqual({ red: '#ff5555', blue: '#0000ff40' })
  })
  it('a bad background or foreground is no custom theme, as before', () => {
    localStorage.setItem('prism.term.custom', JSON.stringify({ bg: 'soup', fg: '#eeeeee', cursor: '#ff0000', ansi: {} }))
    expect(customTermTheme()).toBeNull()
  })
  it('a bad cursor or selection reads as absent', () => {
    localStorage.setItem('prism.term.custom', JSON.stringify({ bg: '#111111', fg: '#eeeeee', cursor: 'soup', selection: 'soup', ansi: {} }))
    const c = customTermTheme()
    expect(c?.cursor).toBe('#eeeeee')
    expect(c?.selection).toBeUndefined()
  })
  it('applyCustomExtras writes only valid colours', () => {
    localStorage.setItem('prism.term.agentColor', '#123456')
    applyCustomExtras({ bg: '#000000', fg: '#ffffff', cursor: '#ff0000', ansi: {}, indicatorColor: 'soup', doneColor: '#11223380', questionColor: '#zzzzzz' })
    expect(localStorage.getItem('prism.term.agentColor')).toBeNull()
    expect(localStorage.getItem('prism.term.agentDoneColor')).toBe('#11223380')
    expect(localStorage.getItem('prism.term.agentQuestionColor')).toBeNull()
  })
  it('termGroundAlpha: 1 for a preset, the Custom background alpha for Custom', () => {
    setTermThemeId('dracula')
    expect(termGroundAlpha()).toBe(1)
    saveCustomTermTheme({ bg: '#11111180', fg: '#eeeeee', cursor: '#ff0000', ansi: {} })
    setTermThemeId('custom')
    expect(termGroundAlpha()).toBeCloseTo(0x80 / 255)
  })
})

// #112: alpha on every colour. Every reader takes 6 or 8 digits; a bad value
// reads as absent; what is stored is the one canonical form.
describe('colours with alpha', () => {
  it('the three agent colours accept hex8 and refuse 7 or 9 digits', () => {
    setAgentColor('#22c55e80')
    expect(agentColorChoice()).toBe('#22c55e80')
    setAgentDoneColor('#22C55E80')
    expect(agentDoneColorChoice()).toBe('#22c55e80')
    setAgentQuestionColor('#3b82f6cc')
    expect(agentQuestionColorChoice()).toBe('#3b82f6cc')
    for (const bad of ['#22c55e8', '#22c55e800']) {
      localStorage.setItem('prism.term.agentColor', bad)
      expect(agentColorChoice()).toBe('')
    }
  })
  it('a picked opaque colour is stored exactly as it always was', () => {
    setAgentColor('#22c55e')
    expect(localStorage.getItem('prism.term.agentColor')).toBe('#22c55e')
  })
  it('the custom theme drops a bad ANSI value and keeps the rest', () => {
    localStorage.setItem(
      'prism.term.custom',
      JSON.stringify({ bg: '#111111', fg: '#EEEEEE', cursor: '#ff000080', selection: '#33445566', ansi: { red: '#ff5555', green: 'soup', blue: '#0000ff40' } })
    )
    const c = customTermTheme()
    expect(c?.fg).toBe('#eeeeee')
    expect(c?.cursor).toBe('#ff000080')
    expect(c?.selection).toBe('#33445566')
    expect(c?.ansi).toEqual({ red: '#ff5555', blue: '#0000ff40' })
  })
  it('a bad background or foreground is no custom theme, as before', () => {
    localStorage.setItem('prism.term.custom', JSON.stringify({ bg: 'soup', fg: '#eeeeee', cursor: '#ff0000', ansi: {} }))
    expect(customTermTheme()).toBeNull()
  })
  it('a bad cursor or selection reads as absent', () => {
    localStorage.setItem('prism.term.custom', JSON.stringify({ bg: '#111111', fg: '#eeeeee', cursor: 'soup', selection: 'soup', ansi: {} }))
    const c = customTermTheme()
    expect(c?.cursor).toBe('#eeeeee')
    expect(c?.selection).toBeUndefined()
  })
  it('applyCustomExtras writes only valid colours', () => {
    localStorage.setItem('prism.term.agentColor', '#123456')
    applyCustomExtras({ bg: '#000000', fg: '#ffffff', cursor: '#ff0000', ansi: {}, indicatorColor: 'soup', doneColor: '#11223380', questionColor: '#zzzzzz' })
    expect(localStorage.getItem('prism.term.agentColor')).toBeNull()
    expect(localStorage.getItem('prism.term.agentDoneColor')).toBe('#11223380')
    expect(localStorage.getItem('prism.term.agentQuestionColor')).toBeNull()
  })
  it('termGroundAlpha: 1 for a preset, the Custom background alpha for Custom', () => {
    setTermThemeId('dracula')
    expect(termGroundAlpha()).toBe(1)
    saveCustomTermTheme({ bg: '#11111180', fg: '#eeeeee', cursor: '#ff0000', ansi: {} })
    setTermThemeId('custom')
    expect(termGroundAlpha()).toBeCloseTo(0x80 / 255)
  })
})

describe('the indicator choices the strip draws', () => {
  const ALL = ['off', 'minimal', 'full'] as const

  it('reads a stored value the strip draws as itself, anything else as the fallback', () => {
    expect(termLook.readIndicator('full', ALL, 'minimal')).toBe('full')
    expect(termLook.readIndicator('ring', ALL, 'minimal')).toBe('minimal')
    for (const raw of [null, '', 'loud', 3]) expect(termLook.readIndicator(raw, ALL, 'minimal')).toBe('minimal')
  })

  it('never answers a value the strip does not draw, even when stored', () => {
    localStorage.setItem('prism.term.agentIndicator', 'ring')
    expect(agentIndicator()).toBe('minimal')
  })

  it('does not write a saved Custom setup\'s unknown indicator over the choice', () => {
    setAgentIndicator('off')
    applyCustomExtras({ bg: '#000000', fg: '#ffffff', cursor: '#ffffff', ansi: {}, indicator: 'ring' as never })
    expect(localStorage.getItem('prism.term.agentIndicator')).toBe('off')
  })
})