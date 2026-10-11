import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureTermCore, resetTermCore, termHost, type TermApi, type TermHostConfig } from './host'
import { agentColorChoice, agentIndicator, paintsAlpha, saveCustomTermTheme, setTermAcrylic, setTermThemeId, termAcrylic, termExtraDefaults, termGroundAlpha, termThemeId, withGroundAlpha } from './lib/termLook'
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

// #114: the Background's alpha is the window's see-through where the terminal
// owns the window's acrylic. Save as Custom carries the alpha IN FORCE onto
// Custom.bg (a picked Background's first, else the Custom's own), and only
// there: in Prism the style owns the glass and a palette stays as it is.
describe('the ground alpha a saved setup carries', () => {
  afterEach(() => resetTermCore())
  beforeEach(() => localStorage.clear())
  const palette = { bg: '#202020', fg: '#eeeeee', cursor: '#ff0000', ansi: {} }

  it('a preset carries no alpha, and a picked see-through background carries its own', () => {
    let picked: string | null = null
    configureTermCore({ ...PRISM_TERMINAL, terminalGround: () => picked })
    setTermThemeId('dracula')
    expect(withGroundAlpha(palette).bg).toBe('#202020')
    picked = '#33333399'
    expect(termGroundAlpha()).toBeCloseTo(0x99 / 255)
    expect(withGroundAlpha(palette).bg).toBe('#20202099')
  })
  it('a Custom carries its own background alpha, unless a picked one is in force', () => {
    let picked: string | null = null
    configureTermCore({ ...PRISM_TERMINAL, terminalGround: () => picked })
    saveCustomTermTheme({ ...palette, bg: '#11111180' })
    setTermThemeId('custom')
    expect(withGroundAlpha(palette).bg).toBe('#20202080')
    picked = '#123456cc'
    expect(withGroundAlpha(palette).bg).toBe('#202020cc')
    picked = '#123456'
    expect(withGroundAlpha({ ...palette, bg: '#20202080' }).bg).toBe('#202020')
  })
  it('in Prism, where the style owns the glass, the palette is left alone', () => {
    configureTermCore(PRISM)
    saveCustomTermTheme({ ...palette, bg: '#11111180' })
    setTermThemeId('custom')
    expect(withGroundAlpha(palette)).toEqual(palette)
  })
})

// #156: the switch alone makes the window see-through where the terminal owns
// the window acrylic, as Prism's "See-through window" does. An opaque ground
// in force paints Prism's default, measured light or dark; a ground that
// carries its own alpha keeps it.
describe('the see-through window (#156)', () => {
  afterEach(() => resetTermCore())
  beforeEach(() => localStorage.clear())

  it('switch on over a preset: the default, by the ground light or dark', () => {
    configureTermCore(PRISM_TERMINAL)
    setTermThemeId('dracula')
    expect(termGroundAlpha()).toBe(1)
    setTermAcrylic(true)
    expect(termGroundAlpha()).toBe(0xb9 / 255)
    setTermThemeId('paper')
    setTermAcrylic(true)
    expect(termGroundAlpha()).toBe(0xd1 / 255)
  })
  it('an opaque picked Background is measured, not the theme under it', () => {
    let picked: string | null = '#ffffff'
    configureTermCore({ ...PRISM_TERMINAL, terminalGround: () => picked })
    setTermThemeId('dracula')
    setTermAcrylic(true)
    expect(termGroundAlpha()).toBe(0xd1 / 255)
    // A picked alpha wins over the default: the Alpha slider still tunes it.
    picked = '#ffffff99'
    expect(termGroundAlpha()).toBe(0x99 / 255)
  })
  it('an opaque Custom paints the default; one with an alpha keeps it', () => {
    configureTermCore(PRISM_TERMINAL)
    saveCustomTermTheme({ bg: '#111111', fg: '#eeeeee', cursor: '#ff0000', ansi: {} })
    setTermThemeId('custom')
    setTermAcrylic(true)
    expect(termGroundAlpha()).toBe(0xb9 / 255)
    saveCustomTermTheme({ bg: '#11111180', fg: '#eeeeee', cursor: '#ff0000', ansi: {} })
    expect(termGroundAlpha()).toBe(0x80 / 255)
  })
  it('Save as Custom carries the default, so a saved setup stays see-through', () => {
    configureTermCore(PRISM_TERMINAL)
    setTermThemeId('dracula')
    setTermAcrylic(true)
    expect(withGroundAlpha({ bg: '#1e1f29' }).bg).toBe('#1e1f29b9')
  })
  it('in Prism, where the style owns the glass, nothing changes', () => {
    configureTermCore(PRISM)
    setTermThemeId('dracula')
    setTermAcrylic(true)
    expect(termGroundAlpha()).toBe(1)
  })
  it('paintsAlpha: the one rule the window and the dirty check share', () => {
    expect(paintsAlpha(1, '#000000', false)).toBe(1)
    expect(paintsAlpha(1, '#000000', true)).toBe(0xb9 / 255)
    expect(paintsAlpha(1, '#ffffff', true)).toBe(0xd1 / 255)
    expect(paintsAlpha(0x80 / 255, '#ffffff', true)).toBe(0x80 / 255)
    // The 30% floor, on or off.
    expect(paintsAlpha(0x05 / 255, '#000000', true)).toBe(0x4d / 255)
  })
})
