import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOVER_SWITCH_MS, createHoverSwitch } from './hoverSwitch'

// A BACKGROUND TAB HELD UNDER A DRAG COMES TO THE FRONT (#70 D12; owner
// approved the spec "as recommended", 2026-11-01): 0.6 s, so the drop can
// land in its list.
describe('createHoverSwitch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits 0.6 s over one tab, then switches to it once', () => {
    const pick = vi.fn()
    const sw = createHoverSwitch(pick)
    expect(HOVER_SWITCH_MS).toBe(600)
    sw.over('b')
    vi.advanceTimersByTime(599)
    sw.over('b') // dragover repeats; it never restarts the wait
    expect(pick).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(pick).toHaveBeenCalledExactlyOnceWith('b')
    vi.advanceTimersByTime(2000)
    sw.over('b')
    vi.advanceTimersByTime(2000)
    expect(pick).toHaveBeenCalledOnce()
  })

  it('starts again for another tab', () => {
    const pick = vi.fn()
    const sw = createHoverSwitch(pick)
    sw.over('b')
    vi.advanceTimersByTime(400)
    sw.over('c')
    vi.advanceTimersByTime(400)
    expect(pick).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(pick).toHaveBeenCalledExactlyOnceWith('c')
  })

  it('a leave, a drop or the drag ending clears it', () => {
    const pick = vi.fn()
    const sw = createHoverSwitch(pick)
    sw.over('b')
    vi.advanceTimersByTime(500)
    sw.clear()
    vi.advanceTimersByTime(1000)
    expect(pick).not.toHaveBeenCalled()
  })

  it('ignores the tab already in front and a null tab', () => {
    const pick = vi.fn()
    const sw = createHoverSwitch(pick)
    sw.over(null)
    vi.advanceTimersByTime(1000)
    expect(pick).not.toHaveBeenCalled()
  })
})
