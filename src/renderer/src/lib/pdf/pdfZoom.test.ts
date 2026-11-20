import { describe, expect, it } from 'vitest'
import { baseZoom, FIT_FLOOR, fitScale, MAX_BASE, PAGE_100_PX, padXFor, zoomPercent } from './pdfZoom'

describe('what 100% means for a document', () => {
  it('leaves US Letter exactly where it was', () => {
    // The whole point of keeping 612 * 1.9 as the target: every document that
    // was already right stays byte-for-byte identical.
    expect(baseZoom(612)).toBeCloseTo(1.9, 10)
  })

  it('leaves A4 within a hair of it', () => {
    expect(baseZoom(595)).toBeCloseTo(1.954, 3)
  })

  it('shrinks a big page so it lands the same width on screen', () => {
    // The artbook that found this: 1822pt pages rendered 3462px across at the
    // old flat 1.9.
    const base = baseZoom(1822)
    expect(Math.round(1822 * base)).toBe(Math.round(PAGE_100_PX))
    expect(base).toBeLessThan(1)
  })

  it('gives every page size the same width at 100%', () => {
    for (const w of [420, 595, 612, 842, 1224, 1822, 2384]) {
      expect(Math.round(w * baseZoom(w))).toBe(Math.round(PAGE_100_PX))
    }
  })

  it('refuses to blow a tiny page up past the cap', () => {
    // 200pt would need 5.8x to reach full width, which is a magnification of
    // a page that has no detail to show at that size.
    expect(baseZoom(200)).toBe(MAX_BASE)
    expect(baseZoom(100)).toBe(MAX_BASE)
  })

  it('falls back to the old baseline for a width that makes no sense', () => {
    // What a document reports before page one has loaded.
    expect(baseZoom(0)).toBe(1.9)
    expect(baseZoom(-5)).toBe(1.9)
    expect(baseZoom(NaN)).toBe(1.9)
  })
})

describe('the percentage the pill shows', () => {
  it('is 100 at the document base, whatever that base is', () => {
    expect(zoomPercent(1.9, 1.9)).toBe(100)
    expect(zoomPercent(baseZoom(1822), baseZoom(1822))).toBe(100)
  })

  it('scales from there', () => {
    expect(zoomPercent(3.8, 1.9)).toBe(200)
    expect(zoomPercent(0.95, 1.9)).toBe(50)
  })

  it('never divides by a base of nothing', () => {
    expect(zoomPercent(1.9, 0)).toBe(100)
  })
})

describe('fitting in a narrow pane (audit #83)', () => {
  it('the gutter shrinks with the box and is 48 from 800 px up', () => {
    expect(padXFor(1000)).toBe(48)
    expect(padXFor(800)).toBe(48)
    expect(padXFor(200)).toBe(12)
    expect(padXFor(40)).toBe(8)
  })
  it('a letter page fits a 200 px pane and a 120 px one (the old 0.25 floor could not)', () => {
    expect(fitScale('fit-width', { w: 200, h: 400 }, { w: 612, h: 792 }, 24, FIT_FLOOR, 5) * 612 + padXFor(200) * 2).toBeLessThanOrEqual(200)
    const s = fitScale('fit-width', { w: 120, h: 400 }, { w: 612, h: 792 }, 24, FIT_FLOOR, 5)
    expect(s).toBeLessThan(0.25)
    expect(612 * s + padXFor(120) * 2).toBeLessThanOrEqual(120)
  })
  it('keeps the old fit in a wide window', () => {
    expect(fitScale('fit-width', { w: 1000, h: 800 }, { w: 612, h: 792 }, 24, FIT_FLOOR, 5)).toBeCloseTo((1000 - 96 - 1) / 612, 6)
  })
})