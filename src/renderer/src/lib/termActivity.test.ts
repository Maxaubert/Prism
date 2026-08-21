import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activitySuppressed, forgetSession, inputEcho, isTouched, markTouched, suppressActivity } from './termActivity'

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
