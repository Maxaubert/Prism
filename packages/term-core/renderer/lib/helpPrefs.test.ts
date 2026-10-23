import { beforeEach, describe, expect, it } from 'vitest'
import {
  HELP_KEYS,
  HELP_WIDTH,
  helpEnabled,
  helpShell,
  helpWidth,
  onHelpPrefs,
  setHelpEnabled,
  setHelpShell,
  setHelpWidth
} from './helpPrefs'

describe('the help panel settings', () => {
  beforeEach(() => localStorage.clear())

  it('is ON until somebody switches it off, and off means off', () => {
    // A discoverability feature is for the people who would never find the
    // switch that turns it on; the owner asked only that it be optional.
    expect(helpEnabled()).toBe(true)
    setHelpEnabled(false)
    expect(helpEnabled()).toBe(false)
    expect(localStorage.getItem(HELP_KEYS.enabled)).toBe('0')
    setHelpEnabled(true)
    expect(helpEnabled()).toBe(true)
  })

  it('remembers a shell picked by hand, and reads anything else as never picked', () => {
    expect(helpShell()).toBeNull()
    setHelpShell('bash')
    expect(helpShell()).toBe('bash')
    localStorage.setItem(HELP_KEYS.shell, 'fish')
    expect(helpShell()).toBeNull()
  })

  it('tells its listeners when a value changes', () => {
    let heard = 0
    const off = onHelpPrefs(() => (heard += 1))
    setHelpEnabled(false)
    off()
    setHelpEnabled(true)
    expect(heard).toBe(1)
  })

  it('keeps its keys under prism.help', () => {
    for (const k of Object.values(HELP_KEYS)) expect(k.startsWith('prism.help.')).toBe(true)
  })
})

describe('how wide the popup is (owner, 2026-09-20)', () => {
  it('is the default until somebody resizes it: never set is not zero', () => {
    // `Number(null)` and `Number('')` are 0, and a naive clamp read that as
    // the NARROWEST popup - which the e2e caught as a cut-off footer line.
    expect(helpWidth()).toBe(HELP_WIDTH.default)
    localStorage.setItem(HELP_KEYS.width, '')
    expect(helpWidth()).toBe(HELP_WIDTH.default)
    localStorage.setItem(HELP_KEYS.width, 'wide')
    expect(helpWidth()).toBe(HELP_WIDTH.default)
  })

  it('remembers a width, and clamps it on the way in and on the way out', () => {
    setHelpWidth(900)
    expect(helpWidth()).toBe(900)
    // A width saved on a big screen must not leave the popup off a small one.
    setHelpWidth(9000)
    expect(helpWidth()).toBe(HELP_WIDTH.max)
    setHelpWidth(10)
    expect(helpWidth()).toBe(HELP_WIDTH.min)
    // And a value somebody else wrote is clamped when it is READ.
    localStorage.setItem(HELP_KEYS.width, '99999')
    expect(helpWidth()).toBe(HELP_WIDTH.max)
  })

  it('rounds to whole pixels and tells its listeners', () => {
    let heard = 0
    const off = onHelpPrefs(() => (heard += 1))
    setHelpWidth(812.6)
    expect(helpWidth()).toBe(813)
    expect(heard).toBe(1)
    off()
  })
})
