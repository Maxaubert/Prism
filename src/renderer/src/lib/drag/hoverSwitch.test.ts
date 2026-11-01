import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOVER_SWITCH_MS, createHoverSwitch, stillInside } from './hoverSwitch'

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

// #70 review (2026-11-01): the in-app carry sends dragleave with no
// relatedTarget whenever the element under the pointer changes, so crossing
// the tab's icon, label or close button read as leaving and restarted the
// wait. A leave counts only when the pointer is really outside the tab.
describe('stillInside', () => {
  const box = { left: 100, top: 10, right: 260, bottom: 42 }
  it('is true for a point on the tab, its edges too', () => {
    expect(stillInside(box, 180, 20)).toBe(true)
    expect(stillInside(box, 100, 10)).toBe(true)
    expect(stillInside(box, 259.5, 41.5)).toBe(true)
  })
  it('is false off the tab', () => {
    expect(stillInside(box, 99, 20)).toBe(false)
    expect(stillInside(box, 180, 43)).toBe(false)
    expect(stillInside(box, 261, 20)).toBe(false)
  })
  it('is false for a leave without a point (0, 0: the drag ended away)', () => {
    expect(stillInside({ left: 0, top: 0, right: 50, bottom: 30 }, 0, 0)).toBe(false)
  })
})
