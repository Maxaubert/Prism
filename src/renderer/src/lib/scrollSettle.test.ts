import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCROLL_SETTLE_MS, createScrollSettle } from './scrollSettle'

describe('createScrollSettle (review, 2026-10-16)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('hands a burst of scroll events up ONCE, with the last position, after it settles', () => {
    const settle = createScrollSettle()
    const commit = vi.fn()
    for (let top = 0; top <= 600; top += 20) {
      settle.scrolled('a', top, commit)
      vi.advanceTimersByTime(16)
    }
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SCROLL_SETTLE_MS)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(600)
  })

  it('a new owner first hands up the old one, so a navigation mid-scroll keeps its place', () => {
    const settle = createScrollSettle()
    const first = vi.fn()
    const second = vi.fn()
    settle.scrolled('a', 300, first)
    settle.scrolled('b', 0, second)
    expect(first).toHaveBeenCalledWith(300)
    expect(second).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SCROLL_SETTLE_MS)
    expect(second).toHaveBeenCalledWith(0)
  })

  it('flush hands up at once; cancel drops it', () => {
    const settle = createScrollSettle()
    const commit = vi.fn()
    settle.scrolled('a', 40, commit)
    settle.flush()
    expect(commit).toHaveBeenCalledWith(40)
    settle.scrolled('a', 80, commit)
    settle.cancel()
    vi.advanceTimersByTime(SCROLL_SETTLE_MS * 2)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
