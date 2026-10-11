import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureTermCore, resetTermCore, type TermHostConfig } from '../../host'
import {
  customTermTheme,
  saveCustomTermTheme,
  setTermAcrylic,
  setTermThemeId,
  withGroundAlpha
} from '../../lib/termLook'
import { paletteOf } from './palette'
import { saveTermSetup, termSetupState } from './useTermSetup'

// Review of #156: Save changes judges, and saves, what the window paints, so a
// picked opaque Background does not light it by its lightness.

let picked: string | null = null
const PRISM_TERMINAL: TermHostConfig = {
  api: {} as TermHostConfig['api'],
  defaults: { theme: 'prism', acrylic: false, indicator: 'minimal', agentColor: '', agentDoneColor: '' },
  followsHostStyle: false,
  paintsGround: true,
  themedAgentColors: () => ({ working: '#5b5bd6', finished: '#22c55e' }),
  acrylic: { kind: 'window', supported: async () => true },
  ownsKey: () => false,
  terminalGround: () => picked
}

describe('the setup Save changes judges (#156 review)', () => {
  beforeEach(() => {
    localStorage.clear()
    picked = null
    configureTermCore(PRISM_TERMINAL)
  })
  afterEach(() => resetTermCore())

  it('an opaque picked Background does not light Save changes, light or dark', () => {
    saveCustomTermTheme({ bg: '#111111', fg: '#eeeeee', cursor: '#ff0000', ansi: {}, acrylic: true })
    setTermThemeId('custom')
    setTermAcrylic(true)
    expect(termSetupState().dirty).toBe(false)
    picked = '#ffffff'
    expect(termSetupState().dirty).toBe(false)
    picked = '#000000'
    expect(termSetupState().dirty).toBe(false)
    // A see-through pick still does.
    picked = '#ffffff99'
    expect(termSetupState().dirty).toBe(true)
  })

  it('a save under an opaque light pick is clean afterwards', () => {
    saveCustomTermTheme({ bg: '#111111', fg: '#eeeeee', cursor: '#ff0000', ansi: {}, acrylic: true })
    setTermThemeId('custom')
    setTermAcrylic(true)
    picked = '#ffffff'
    saveTermSetup()
    // The level the window painted (white's d1), not the Custom's own b9:
    // saving b9 left Save changes lit after every save.
    expect(customTermTheme()?.bg).toBe('#111111d1')
    expect(termSetupState().dirty).toBe(false)
  })

  it('editing a light preset that is not the active theme opens at its own level', () => {
    // Every preset card has an edit button: with no pick, the window's ground
    // is the ACTIVE (dark) theme's, which says nothing about this palette.
    setTermThemeId('prism')
    setTermAcrylic(true)
    expect(withGroundAlpha(paletteOf('catppuccin-latte')).bg.slice(-2)).toBe('d1')
    // Under an opaque pick the pick is what paints, for any palette.
    picked = '#111111'
    expect(withGroundAlpha(paletteOf('catppuccin-latte')).bg.slice(-2)).toBe('b9')
  })
})
