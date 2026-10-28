import { describe, expect, it, vi } from 'vitest'
import { CHROME_FADE, CHROME_IDLE, chromeClockRuns, chromeStep } from './autoHideChrome'

describe('the auto-hide clock (perf review, 2026-10-28)', () => {
  it('runs only while the chrome is up, so a hidden viewer schedules nothing', () => {
    expect(chromeClockRuns(true)).toBe(true)
    expect(chromeClockRuns(false)).toBe(false)
  })

  it('waits while there was activity inside the idle time', () => {
    const pinned = vi.fn(() => false)
    expect(chromeStep(10_000, 0, 10_000 - CHROME_IDLE + 1, CHROME_IDLE, pinned)).toBe('wait')
    // The :hover query is a DOM read: never asked before the idle mark.
    expect(pinned).not.toHaveBeenCalled()
  })

  it('starts the fade once idle, unless the pointer rests on the chrome', () => {
    expect(chromeStep(10_000, 0, 10_000 - CHROME_IDLE, CHROME_IDLE, () => false)).toBe('fade')
    expect(chromeStep(10_000, 0, 10_000 - CHROME_IDLE, CHROME_IDLE, () => true)).toBe('wait')
  })

  it('takes the element out when the fade has run its length, not before', () => {
    const pinned = (): boolean => false
    expect(chromeStep(1000 + CHROME_FADE - 1, 1000, 0, CHROME_IDLE, pinned)).toBe('wait')
    expect(chromeStep(1000 + CHROME_FADE, 1000, 0, CHROME_IDLE, pinned)).toBe('gone')
  })
})
