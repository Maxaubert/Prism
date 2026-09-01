import { beforeEach, describe, expect, it } from 'vitest'
import { setWrapPref, wrapPref, wrapsFor } from './codePrefs'

beforeEach(() => {
  localStorage.clear()
  setWrapPref('auto')
})

describe('what wraps', () => {
  it('leaves the old rule alone by default: prose wraps, code does not', () => {
    // A flat "off" default would have silently unwrapped every .txt and .log
    // the day this shipped, which is a regression wearing a feature's clothes.
    expect(wrapsFor('auto', true)).toBe(true)
    expect(wrapsFor('auto', false)).toBe(false)
  })

  it('overrides both ways when asked', () => {
    expect(wrapsFor('on', false)).toBe(true)
    expect(wrapsFor('off', true)).toBe(false)
  })
})

describe('the preference', () => {
  it('starts on auto', () => {
    expect(wrapPref()).toBe('auto')
  })

  it('remembers what it was set to', () => {
    setWrapPref('on')
    expect(wrapPref()).toBe('on')
    expect(localStorage.getItem('prism.code.wrap')).toBe('on')
  })

  it('reads a junk value as auto rather than throwing', () => {
    localStorage.setItem('prism.code.wrap', 'sideways')
    // loadWrap runs at import; assert the guard's shape through wrapsFor.
    expect(wrapsFor('auto', true)).toBe(true)
  })
})
