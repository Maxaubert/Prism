import { describe, expect, it } from 'vitest'
import { onOverlayScrollbar, sameTracks, scrollsByStyle, thumbFor, type Bar } from './overlayScroll'

describe('overlay bars (review, 2026-10-28)', () => {
  it('draws an axis only where the style lets it scroll', () => {
    expect(['auto', 'scroll', 'overlay'].every(scrollsByStyle)).toBe(true)
    expect(['hidden', 'visible', 'clip', ''].some(scrollsByStyle)).toBe(false)
  })
  it('tells a thumb-only move from a track change', () => {
    const bar = (start: number, length = 200, size = 40): Bar => ({
      axis: 'y',
      left: 10,
      top: 0,
      length,
      thumb: { scrollable: true, start, size }
    })
    expect(sameTracks([bar(0)], [bar(80)])).toBe(true)
    expect(sameTracks([bar(0)], [bar(0, 300)])).toBe(false)
    expect(sameTracks([bar(0)], [bar(0, 200, 60)])).toBe(false)
    expect(sameTracks([bar(0)], [])).toBe(false)
    expect(sameTracks([], [])).toBe(true)
  })
  it('knows a press on the bar, for outside-press closers', () => {
    const inside = { closest: (s: string) => (s === '[data-overlay-scrollbar]' ? {} : null) }
    const elsewhere = { closest: () => null }
    expect(onOverlayScrollbar(inside as unknown as EventTarget)).toBe(true)
    expect(onOverlayScrollbar(elsewhere as unknown as EventTarget)).toBe(false)
    // A text node has no closest(): not the bar.
    expect(onOverlayScrollbar({} as EventTarget)).toBe(false)
    expect(onOverlayScrollbar(null)).toBe(false)
  })
})

const m = {
  scrollTop: 0,
  scrollLeft: 0,
  scrollHeight: 1000,
  scrollWidth: 300,
  clientHeight: 250,
  clientWidth: 300
}

describe('thumbFor', () => {
  it('sizes the thumb by the share in view, at least 28 px', () => {
    expect(thumbFor(m, 'y')).toEqual({ scrollable: true, start: 0, size: 62.5 })
    expect(thumbFor({ ...m, scrollHeight: 100_000 }, 'y').size).toBe(28)
  })
  it('places it by how far the content has scrolled', () => {
    expect(thumbFor({ ...m, scrollTop: 750 }, 'y').start).toBeCloseTo(250 - 62.5)
    expect(thumbFor({ ...m, scrollTop: 375 }, 'y').start).toBeCloseTo((250 - 62.5) / 2)
  })
  it('draws nothing for an axis that does not scroll', () => {
    expect(thumbFor(m, 'x').scrollable).toBe(false)
    expect(thumbFor({ ...m, scrollWidth: 900 }, 'x').scrollable).toBe(true)
  })
})
