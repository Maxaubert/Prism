import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activitySuppressed,
  forgetSession,
  idleAtPrompt,
  inputEcho,
  isTouched,
  looksTyped,
  markPrompt,
  markTouched,
  suppressActivity
} from './termActivity'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => vi.useRealTimers())

describe('input echo: output right behind a keystroke is not the agent working', () => {
  it('a fresh keystroke opens the echo window', () => {
    markTouched('s1')
    expect(inputEcho('s1')).toBe(true)
  })
  it('the window closes once typing stops', () => {
    markTouched('s1')
    vi.advanceTimersByTime(400)
    expect(inputEcho('s1')).toBe(false)
  })
  it('continuous typing keeps renewing it', () => {
    for (let i = 0; i < 10; i += 1) {
      markTouched('s1')
      vi.advanceTimersByTime(200)
      expect(inputEcho('s1')).toBe(true)
    }
  })
  it('a session never typed into has no window', () => {
    expect(inputEcho('never')).toBe(false)
  })
  it('forgetSession clears it along with touched', () => {
    markTouched('s2')
    expect(isTouched('s2')).toBe(true)
    forgetSession('s2')
    expect(inputEcho('s2')).toBe(false)
    expect(isTouched('s2')).toBe(false)
  })
})

describe('suppression windows', () => {
  it('suppression expires on schedule', () => {
    suppressActivity('s3', 800)
    expect(activitySuppressed('s3')).toBe(true)
    vi.advanceTimersByTime(900)
    expect(activitySuppressed('s3')).toBe(false)
  })
})

describe('looksTyped (#99)', () => {
  it('counts plain text as typing and every ESC-led reply as not', () => {
    expect(looksTyped('a')).toBe(true)
    expect(looksTyped('日本')).toBe(true) // an IME commit
    expect(looksTyped('')).toBe(false)
    expect(looksTyped('\x1b[I')).toBe(false) // focus in
    expect(looksTyped('\x1b[O')).toBe(false) // focus out
    expect(looksTyped('\x1b[?1;2c')).toBe(false) // device attributes
    expect(looksTyped('\x1b[12;40R')).toBe(false) // cursor position
    expect(looksTyped('\x1b[200~pasted\x1b[201~')).toBe(false) // bracketed paste: marked by its caller
  })
})

describe('idleAtPrompt (#99)', () => {
  it('is true only once a prompt has appeared after the last keystroke', () => {
    expect(idleAtPrompt('s')).toBe(false)
    markPrompt('s')
    expect(idleAtPrompt('s')).toBe(true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 10)
    markTouched('s')
    expect(idleAtPrompt('s')).toBe(false)
    vi.setSystemTime(Date.now() + 10)
    markPrompt('s')
    expect(idleAtPrompt('s')).toBe(true)
    vi.useRealTimers()
    forgetSession('s')
    expect(idleAtPrompt('s')).toBe(false)
  })
})
