import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureTermCore, resetTermCore, type TermHostConfig } from '../../host'
import {
  customTermTheme,
  saveCustomTermTheme,
  setTermSeeThrough,
  setTermThemeId,
  withGroundAlpha
} from '../../lib/termLook'
import { paletteOf } from './palette'
import { saveTermSetup, termSetupState } from './useTermSetup'

// The see-through slider is part of the theme (owner, 2026-10-13: "Like
// Prism: an edit"): a moved slider lights Save changes, a save keeps it with
// Custom, and the ground is saved opaque. A picked Background's lightness or
// alpha says nothing about it.

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

describe('the see-through level in Save changes', () => {
  beforeEach(() => {
    localStorage.clear()
    picked = null
    configureTermCore(PRISM_TERMINAL)
  })
  afterEach(() => resetTermCore())

  it('a preset at 0 is clean; a moved slider is a change to save', () => {
    setTermThemeId('dracula')
    expect(termSetupState().dirty).toBe(false)
    setTermSeeThrough(35)
    expect(termSetupState().dirty).toBe(true)
    setTermSeeThrough(0)
    expect(termSetupState().dirty).toBe(false)
  })

  it('a picked Background never lights it, opaque or not', () => {
    setTermThemeId('dracula')
    picked = '#ffffff'
    expect(termSetupState().dirty).toBe(false)
    picked = '#ffffff99'
    expect(termSetupState().dirty).toBe(false)
  })

  it('a save keeps the level with Custom, on an opaque ground, and is clean afterwards', () => {
    setTermThemeId('dracula')
    setTermSeeThrough(35)
    saveTermSetup()
    const c = customTermTheme()
    expect(c?.seeThrough).toBe(35)
    expect(c?.bg).toHaveLength(7)
    expect(c && 'acrylic' in c).toBe(false)
    expect(termSetupState().dirty).toBe(false)
    // A Custom at its own level is clean; moved off it, a change again.
    setTermSeeThrough(20)
    expect(termSetupState().dirty).toBe(true)
  })

  it('the editor opens on an opaque ground', () => {
    saveCustomTermTheme({ bg: '#11111180', fg: '#eeeeee', cursor: '#ff0000', ansi: {} })
    expect(withGroundAlpha(paletteOf('custom')).bg).toBe('#111111')
  })
})
