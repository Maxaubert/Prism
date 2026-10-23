import { afterEach, describe, expect, it, vi } from 'vitest'
import { holdTermFit, releaseTermFit, termFitHeld, whenTermFitReleased } from './fitHold'

describe('holding the terminals’ size while their room animates (2026-10-16)', () => {
  afterEach(() => {
    releaseTermFit()
    vi.useRealTimers()
  })

  it('holds for its time, then runs each waiting fit once', () => {
    vi.useFakeTimers()
    const fit = vi.fn()
    holdTermFit(280)
    expect(termFitHeld()).toBe(true)
    whenTermFitReleased(fit)
    whenTermFitReleased(fit)
    vi.advanceTimersByTime(279)
    expect(fit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(termFitHeld()).toBe(false)
    expect(fit).toHaveBeenCalledTimes(1)
  })

  it('a second hold extends the first', () => {
    vi.useFakeTimers()
    const fit = vi.fn()
    holdTermFit(200)
    vi.advanceTimersByTime(150)
    holdTermFit(200)
    whenTermFitReleased(fit)
    vi.advanceTimersByTime(150)
    expect(fit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(fit).toHaveBeenCalledTimes(1)
  })

  it('one fit that throws does not stop the others', () => {
    const after = vi.fn()
    holdTermFit(1000)
    whenTermFitReleased(() => {
      throw new Error('gone')
    })
    whenTermFitReleased(after)
    releaseTermFit()
    expect(after).toHaveBeenCalledTimes(1)
  })
})
