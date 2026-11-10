import { describe, expect, it } from 'vitest'
import { createZoomWheel } from './zoomWheel'

// Ctrl+wheel to steps. Up (a negative deltaY) is bigger, as File Explorer.
const notch = (deltaY: number, deltaMode = 0) => ({ deltaY, deltaMode })

describe('zoom wheel', () => {
  it('one mouse notch is one step, up is bigger', () => {
    const w = createZoomWheel()
    expect(w.feed(notch(-100), 0)).toBe(1)
    expect(w.feed(notch(100), 1000)).toBe(-1)
  })

  it('reads lines and pages as pixels', () => {
    const w = createZoomWheel()
    expect(w.feed(notch(-3, 1), 0)).toBe(1) // 3 lines = 120px
    expect(w.feed(notch(-1, 2), 1000)).toBe(1) // a page = 800px, but one step per event
  })

  it('a pinch of small fractional deltas crosses about three steps', () => {
    const w = createZoomWheel()
    let total = 0
    let t = 0
    for (let i = 0; i < 30; i++) {
      total += w.feed(notch(-4.5), t)
      t += 70
    }
    expect(total).toBe(3)
  })

  it('a change of direction drops what was gathered', () => {
    const w = createZoomWheel()
    expect(w.feed(notch(-4.5), 0)).toBe(0)
    expect(w.feed(notch(-4.5), 70)).toBe(0)
    expect(w.feed(notch(9.5), 140)).toBe(0)
    let sum = 0
    for (let i = 0; i < 4; i++) sum += w.feed(notch(9.5), 210 + i * 70)
    // 9.5 x 5 events = 47.5 gathered after the reversal: one pinch step, never an up one
    expect(sum).toBe(-1)
  })

  it('a pause over 250ms drops what was gathered', () => {
    const w = createZoomWheel()
    expect(w.feed(notch(-30.5), 0)).toBe(0)
    // 61px in all would be a step: the pause means it is not
    expect(w.feed(notch(-30.5), 300)).toBe(0)
    expect(w.feed(notch(-30.5), 360)).toBe(1)
  })

  it('never more than one step per 60ms, and the rest carries', () => {
    const w = createZoomWheel()
    expect(w.feed(notch(-250), 0)).toBe(1)
    expect(w.feed(notch(-100), 30)).toBe(0)
    expect(w.feed(notch(-100), 70)).toBe(1)
    expect(w.feed(notch(-100), 140)).toBe(1)
  })

  it('swallows the wheel at an end and keeps nothing for later', () => {
    const w = createZoomWheel()
    expect(w.feed(notch(-100), 0, { zoomIn: false, zoomOut: true })).toBe(0)
    expect(w.feed(notch(-100), 100, { zoomIn: true, zoomOut: true })).toBe(1)
    w.feed(notch(-60), 200, { zoomIn: false, zoomOut: true })
    expect(w.feed(notch(-60), 260, { zoomIn: true, zoomOut: true })).toBe(0)
  })

  it('ignores a wheel with no travel', () => {
    expect(createZoomWheel().feed(notch(0), 0)).toBe(0)
  })
})
