import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureTermCore, resetTermCore, termHost, type TermApi, type TermHostConfig } from './host'
import { agentColorChoice, agentIndicator, applyCustomExtras, paintsAlpha, resetTermExtras, saveCustomTermTheme, SEE_THROUGH_TOP, setTermAcrylic, setTermSeeThrough, setTermThemeId, termAcrylic, termExtraDefaults, termGroundAlpha, termSeeThrough, termThemeId, withGroundAlpha } from './lib/termLook'
import { CH } from '../shared/channels'

// The seam is what lets ONE terminal serve two apps. These tests are the two
// apps: each host's defaults, read through the same stores.

const api = {} as TermApi

/** Prism Terminal: the theme drives the window, quiet by default. */
const PRISM_TERMINAL: TermHostConfig = {
  api,
  defaults: { theme: 'prism', acrylic: false, indicator: 'minimal', agentColor: '', agentDoneColor: '' },
  followsHostStyle: false,
  paintsGround: true,
  themedAgentColors: () => ({ working: '#5b5bd6', finished: '#22c55e' }),
  acrylic: { kind: 'window', supported: async () => true },
  ownsKey: () => false
}

/** Prism, as it ships today: the terminal wears the app style. */
const PRISM: TermHostConfig = {
  api,
  defaults: { theme: 'style', acrylic: true, indicator: 'full', agentColor: '#f97316', agentDoneColor: '#22c55e' },
  followsHostStyle: true,
  paintsGround: false,
  themedAgentColors: () => ({ working: '#3f5570', finished: '#22c55e' }),
  acrylic: { kind: 'style' },
  ownsKey: () => false
}

describe('the host seam', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => resetTermCore())

  it('refuses to be used before a host has spoken', () => {
    expect(() => termHost()).toThrow(/configureTermCore/)
  })

  it('an untouched setting reads as ITS HOST says, so adopting the core changes nothing a user sees', () => {
    configureTermCore(PRISM)
    expect([termThemeId(), termAcrylic(), agentIndicator(), agentColorChoice()]).toEqual(['style', true, 'full', '#f97316'])
    configureTermCore(PRISM_TERMINAL)
    expect([termThemeId(), termAcrylic(), agentIndicator(), agentColorChoice()]).toEqual(['prism', false, 'minimal', ''])
  })

  it('a setting the user DID touch wins over either host', () => {
    localStorage.setItem('prism.term.theme', 'dracula')
    localStorage.setItem('prism.term.acrylic', '0')
    localStorage.setItem('prism.term.agentIndicator', 'off')
    for (const host of [PRISM, PRISM_TERMINAL]) {
      configureTermCore(host)
      expect([termThemeId(), termAcrylic(), agentIndicator()]).toEqual(['dracula', false, 'off'])
    }
  })

  it("'style' is a theme only where the host has a style to follow", () => {
    localStorage.setItem('prism.term.theme', 'style')
    configureTermCore(PRISM)
    expect(termThemeId()).toBe('style')
    // A save carried over from Prism must not leave a theme nothing can resolve.
    configureTermCore(PRISM_TERMINAL)
    expect(termThemeId()).toBe('prism')
  })

  it('"what a theme pick resets to" follows the host too', () => {
    configureTermCore(PRISM)
    expect(termExtraDefaults()).toMatchObject({ indicator: 'full', acrylic: true, indicatorColor: '#f97316' })
    configureTermCore(PRISM_TERMINAL)
    expect(termExtraDefaults()).toMatchObject({ indicator: 'minimal', acrylic: false, indicatorColor: '' })
  })
})

describe('the channel table', () => {
  it('names every channel once, and no two alike', () => {
    const names = Object.values(CH)
    expect(new Set(names).size).toBe(names.length)
    // main's terminal.ts sends these two by their literal names.
    expect([CH.data, CH.exit]).toEqual(['term:data', 'term:exit'])
  })
})

// THE SEE-THROUGH SLIDER (owner, 2026-10-13: "make it a slider only with it
// being at 0 by default"): where the terminal owns the window acrylic, the
// window's see-through is the slider's level, never a colour's alpha, and
// Custom saves the ground opaque beside it. In Prism the style owns the glass:
// the switch, and a palette left as it is.
describe('the see-through slider', () => {
  afterEach(() => resetTermCore())
  beforeEach(() => localStorage.clear())
  const palette = { bg: '#20202080', fg: '#eeeeee', cursor: '#ff0000', ansi: {} }

  it('0 by default: the window solid and the material off', () => {
    configureTermCore(PRISM_TERMINAL)
    expect(termSeeThrough()).toBe(0)
    expect(termAcrylic()).toBe(false)
    expect(termGroundAlpha()).toBe(1)
  })
  it('a level paints the ground at 1 - level/100 and turns the material on', () => {
    configureTermCore(PRISM_TERMINAL)
    setTermSeeThrough(40)
    expect(termAcrylic()).toBe(true)
    expect(termGroundAlpha()).toBeCloseTo(0.6)
    setTermSeeThrough(0)
    expect(termAcrylic()).toBe(false)
  })
  it('read clamped to 0-70, the 30% floor; nonsense reads 0', () => {
    configureTermCore(PRISM_TERMINAL)
    setTermSeeThrough(95)
    expect(termSeeThrough()).toBe(SEE_THROUGH_TOP)
    expect(termGroundAlpha()).toBeCloseTo(0.3)
    localStorage.setItem('prism.term.seeThrough', 'glass')
    expect(termSeeThrough()).toBe(0)
  })
  it('a colour alpha is no see-through any more: a picked or Custom alpha paints nothing', () => {
    configureTermCore({ ...PRISM_TERMINAL, terminalGround: () => '#33333399' })
    saveCustomTermTheme({ ...palette, bg: '#11111180' })
    setTermThemeId('custom')
    expect(termGroundAlpha()).toBe(1)
  })
  it('Custom saves the ground opaque', () => {
    configureTermCore(PRISM_TERMINAL)
    expect(withGroundAlpha(palette).bg).toBe('#202020')
  })
  it('a theme pick puts its own level back, 0; a Custom brings back its saved level', () => {
    configureTermCore(PRISM_TERMINAL)
    setTermSeeThrough(30)
    resetTermExtras()
    expect(termSeeThrough()).toBe(0)
    applyCustomExtras({ ...palette, seeThrough: 25 })
    expect(termSeeThrough()).toBe(25)
    applyCustomExtras({ ...palette })
    expect(termSeeThrough()).toBe(0)
  })
  it('in Prism, where the style owns the glass, the palette is left alone and the switch stays', () => {
    configureTermCore(PRISM)
    saveCustomTermTheme({ ...palette, bg: '#11111180' })
    setTermThemeId('custom')
    expect(withGroundAlpha(palette)).toEqual(palette)
    expect(termAcrylic()).toBe(true)
    setTermAcrylic(false)
    expect(termAcrylic()).toBe(false)
  })
  it('in Prism, where the style owns the glass, nothing changes', () => {
    configureTermCore(PRISM)
    setTermThemeId('dracula')
    setTermAcrylic(true)
    expect(termGroundAlpha()).toBe(1)
  })
  it('paintsAlpha: the old rule, which the move to the slider reads', () => {
    expect(paintsAlpha(1, '#000000', false)).toBe(1)
    expect(paintsAlpha(1, '#000000', true)).toBe(0xb9 / 255)
    expect(paintsAlpha(1, '#ffffff', true)).toBe(0xd1 / 255)
    expect(paintsAlpha(0x80 / 255, '#ffffff', true)).toBe(0x80 / 255)
    // The 30% floor, on or off.
    expect(paintsAlpha(0x05 / 255, '#000000', true)).toBe(0x4d / 255)
  })
})
