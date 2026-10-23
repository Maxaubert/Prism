import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureTermCore, resetTermCore, type TermApi, type TermHostConfig } from '../host'
import type { DictationApi } from '../../preload/dictationApi'
import { DEFAULT_HOTKEY, formatHotkey, initialKeyState, reduceKey, type Hotkey } from './dictationKey'
import { DICTATION_KEYS, defaultDictationHotkey, dictationHotkey, setDictationHotkey } from './dictationPrefs'

// THE DEFAULT KEY IS THE HOST'S (2026-10-23). Core 0.43.0 moved the built-in
// default from Right Alt to Ctrl+Win for Prism Terminal's global key, and Prism,
// which never saves a key, silently moved with it: holding Right Alt over its
// terminal stopped dictating (Prism #429, the red `dictation` gate). A host now
// declares its default; one that does not gets the core's Ctrl+Win.

const RIGHT_ALT: Hotkey = { code: 'AltRight', ctrl: false, alt: false, shift: false, meta: false }

function host(defaultHotkey?: Hotkey): TermHostConfig {
  return {
    api: {} as TermApi,
    defaults: { theme: 'style', acrylic: true, indicator: 'minimal', agentColor: '', agentDoneColor: '' },
    followsHostStyle: true,
    paintsGround: true,
    themedAgentColors: () => ({ working: '#5b5bd6', finished: '#22c55e' }),
    acrylic: { kind: 'style' },
    ownsKey: () => false,
    dictation: { api: {} as DictationApi, canDictate: () => true, defaultHotkey }
  }
}

describe('the default dictation key', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => resetTermCore())

  it('is the core default (Ctrl+Win) where no host has spoken', () => {
    expect(defaultDictationHotkey()).toEqual(DEFAULT_HOTKEY)
    expect(dictationHotkey()).toEqual(DEFAULT_HOTKEY)
  })

  it('is the core default where the host declares none', () => {
    configureTermCore(host())
    expect(formatHotkey(dictationHotkey())).toBe('Ctrl+Win')
  })

  it("is the host's where it declares one (Prism: Right Alt), with nothing saved", () => {
    configureTermCore(host(RIGHT_ALT))
    expect(formatHotkey(dictationHotkey())).toBe('Right Alt')
  })

  it('follows the host even after a read made before the host spoke', () => {
    // A read at import time caches the parse; the host must still win after.
    expect(dictationHotkey()).toEqual(DEFAULT_HOTKEY)
    configureTermCore(host(RIGHT_ALT))
    expect(dictationHotkey()).toEqual(RIGHT_ALT)
  })

  it("a user's saved key still wins over the host's default", () => {
    configureTermCore(host(RIGHT_ALT))
    setDictationHotkey(DEFAULT_HOTKEY)
    expect(dictationHotkey()).toEqual(DEFAULT_HOTKEY)
  })

  it('a damaged saved value reads as the HOST default', () => {
    configureTermCore(host(RIGHT_ALT))
    localStorage.setItem(DICTATION_KEYS.hotkey, '{nope')
    expect(dictationHotkey()).toEqual(RIGHT_ALT)
  })

  it('a held Right Alt starts dictation under the host default', () => {
    configureTermCore(host(RIGHT_ALT))
    const hotkey = dictationHotkey()
    const opts = { hotkey, mode: 'hold' as const }
    const down = reduceKey(
      initialKeyState(),
      { type: 'down', code: 'AltRight', ctrl: false, alt: true, shift: false, meta: false, at: 0 },
      opts
    )
    const held = reduceKey(down.state, { type: 'tick', at: 1000 }, opts)
    expect(held.action).toBe('start')
  })
})
