import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureTermCore, resetTermCore, type TermHostConfig } from '../../host'
import { customTermTheme, setTermAcrylic, setTermThemeId } from '../../lib/termLook'
import { saveTermSetup, termSetupState } from './useTermSetup'

// The acrylic switch is part of the theme: a flipped switch lights Save
// changes, and a save keeps it with Custom.

const PRISM: TermHostConfig = {
  api: {} as TermHostConfig['api'],
  defaults: { theme: 'style', acrylic: true, indicator: 'full', agentColor: '', agentDoneColor: '' },
  followsHostStyle: true,
  paintsGround: false,
  themedAgentColors: () => ({ working: '#5b5bd6', finished: '#22c55e' }),
  acrylic: { kind: 'style' },
  ownsKey: () => false
}

describe('the acrylic switch in Save changes', () => {
  beforeEach(() => {
    localStorage.clear()
    configureTermCore(PRISM)
  })
  afterEach(() => resetTermCore())

  it('a preset at the default is clean; a flipped switch is a change to save', () => {
    setTermThemeId('dracula')
    expect(termSetupState().dirty).toBe(false)
    setTermAcrylic(false)
    expect(termSetupState().dirty).toBe(true)
    setTermAcrylic(true)
    expect(termSetupState().dirty).toBe(false)
  })

  it('a save keeps the switch with Custom and is clean afterwards', () => {
    setTermThemeId('dracula')
    setTermAcrylic(false)
    saveTermSetup()
    const c = customTermTheme()
    expect(c?.acrylic).toBe(false)
    expect(termSetupState().dirty).toBe(false)
    // A Custom at its own setting is clean; moved off it, a change again.
    setTermAcrylic(true)
    expect(termSetupState().dirty).toBe(true)
  })
})