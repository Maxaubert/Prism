import { describe, expect, it } from 'vitest'
import {
  bandBox,
  clampToView,
  clientToContent,
  contentToClient,
  edgeSpeed,
  inSpan,
  onRowOwnPart,
  nearestRow,
  rowsInBand,
  rowsInBox,
  sameHits,
  sameSpan,
  snapBox,
  sweepMark,
  sweepSelect
} from './marquee'

describe('snapBox (#332: the box in whole device pixels)', () => {
  const whole = (v: number, dpr: number): boolean => Math.abs(v * dpr - Math.round(v * dpr)) < 1e-9
  it('puts every edge on a device pixel, at any zoom', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 2.25, 3]) {
      const b = snapBox({ x: 10.3, y: 20.7 }, { x: 103.45, y: 7.1 }, dpr)
      for (const v of [b.left, b.top, b.left + b.width, b.top + b.height]) expect(whole(v, dpr)).toBe(true)
    }
  })
  it('keeps the anchored edge exactly where it was while the other moves', () => {
    const anchor = { x: 50.37, y: 80.81 }
    const lefts = new Set<number>()
    const tops = new Set<number>()
    for (let i = 0; i < 40; i++) {
      const b = snapBox(anchor, { x: 60 + i * 3.7, y: 90 + i * 2.3 }, 2.25)
      lefts.add(b.left)
      tops.add(b.top)
    }
    expect(lefts.size).toBe(1)
    expect(tops.size).toBe(1)
  })
  it('covers both corner pixels, so a box level with the press is one device pixel', () => {
    const b = snapBox({ x: 10, y: 10 }, { x: 10, y: 40 }, 2)
    expect(b.width).toBe(0.5)
    expect(b.height).toBe(30.5)
  })
  it('is the same box drawn either way round', () => {
    expect(snapBox({ x: 5, y: 9 }, { x: 1, y: 2 }, 1.5)).toEqual(snapBox({ x: 1, y: 2 }, { x: 5, y: 9 }, 1.5))
  })
})

describe('the anchor kept in content (#332)', () => {
  it('maps to the screen and back unchanged', () => {
    const origin = { x: 300.5, y: 120.25 }
    const scroll = { x: 0, y: 417.6 }
    const p = { x: 40, y: 900 }
    expect(clientToContent(contentToClient(p, origin, scroll), origin, scroll)).toEqual(p)
  })
  it('moves on screen exactly as far as the list scrolled, the other way', () => {
    const origin = { x: 0, y: 100 }
    const p = { x: 10, y: 500 }
    const a = contentToClient(p, origin, { x: 0, y: 200 })
    const b = contentToClient(p, origin, { x: 0, y: 222 })
    expect(a.y - b.y).toBe(22)
    expect(a.x).toBe(b.x)
  })
  it('is held to the list plus a pixel, as Explorer holds its marquee', () => {
    const view = { left: 100, top: 50, right: 400, bottom: 650 }
    expect(clampToView({ x: 20, y: -300 }, view)).toEqual({ x: 99, y: 49 })
    expect(clampToView({ x: 900, y: 9000 }, view)).toEqual({ x: 401, y: 651 })
    expect(clampToView({ x: 200, y: 300 }, view)).toEqual({ x: 200, y: 300 })
  })
})

describe('the incremental hit set (#332)', () => {
  it('a move that covers the same rows is no change', () => {
    expect(sameSpan({ first: 2, last: 9, near: 9 }, { first: 2, last: 9, near: 3 })).toBe(true)
    expect(sameSpan(null, null)).toBe(true)
  })
  it('a row more or less, or none at all, is a change', () => {
    expect(sameSpan({ first: 2, last: 9, near: 9 }, { first: 2, last: 10, near: 10 })).toBe(false)
    expect(sameSpan({ first: 2, last: 9, near: 9 }, { first: 1, last: 9, near: 1 })).toBe(false)
    expect(sameSpan(null, { first: 0, last: 0, near: 0 })).toBe(false)
    expect(sameSpan({ first: 0, last: 0, near: 0 }, null)).toBe(false)
  })
  it('a row is in the span from its first to its last, both included', () => {
    const s = { first: 3, last: 5, near: 5 }
    expect([2, 3, 4, 5, 6].map((i) => inSpan(s, i))).toEqual([false, true, true, true, false])
    expect(inSpan(null, 0)).toBe(false)
  })
  it('a covered row is on, a row marked before and not covered is off, the rest untouched', () => {
    expect(sweepMark(true, false)).toBe('on')
    expect(sweepMark(true, true)).toBe('on')
    expect(sweepMark(false, true)).toBe('off')
    expect(sweepMark(false, false)).toBeNull()
  })
})

describe('rowsInBand', () => {
  it('takes every row the span overlaps, either direction', () => {
    expect(rowsInBand(30, 80, 26, 10)).toEqual({ first: 1, last: 3 })
    expect(rowsInBand(80, 30, 26, 10)).toEqual({ first: 1, last: 3 })
  })
  it('a span inside one row takes that row', () => {
    expect(rowsInBand(28, 30, 26, 10)).toEqual({ first: 1, last: 1 })
  })
  it('a span ending exactly on a boundary does not take the row below', () => {
    expect(rowsInBand(0, 52, 26, 10)).toEqual({ first: 0, last: 1 })
  })
  it('clamps to the rows that exist', () => {
    expect(rowsInBand(-50, 9999, 26, 4)).toEqual({ first: 0, last: 3 })
  })
  it('a span wholly below the last row or above the first touches nothing', () => {
    expect(rowsInBand(200, 300, 26, 4)).toBeNull()
    expect(rowsInBand(-40, -10, 26, 4)).toBeNull()
    expect(rowsInBand(0, 10, 26, 0)).toBeNull()
  })
  it('works by arithmetic for rows far outside the view (virtual lists)', () => {
    expect(rowsInBand(26 * 5000, 26 * 5002 + 1, 26, 100000)).toEqual({ first: 5000, last: 5002 })
  })
})

describe('rowsInBox', () => {
  // A details row as the Explorer draws it: from the list's left edge to the
  // right edge of its last column, with blank space beside it (#326).
  const row = { left: 0, right: 600, height: 26 }
  const inset = { left: 40, right: 600, height: 26 }
  it('a box wholly to the right of the rows marks nothing, at any height', () => {
    // The owner's screenshot: a rectangle in the empty space past Date modified.
    expect(rowsInBox({ left: 700, right: 840, top: 30, bottom: 160 }, row, 10)).toBeNull()
    expect(rowsInBox({ left: 840, right: 700, top: 160, bottom: 30 }, row, 10)).toBeNull()
  })
  it('a box wholly to the left of the rows marks nothing', () => {
    expect(rowsInBox({ left: 0, right: 39, top: 30, bottom: 160 }, inset, 10)).toBeNull()
  })
  it('a box that reaches one pixel into the rows marks them', () => {
    expect(rowsInBox({ left: 599, right: 760, top: 30, bottom: 80 }, row, 10)).toEqual({ first: 1, last: 3 })
    expect(rowsInBox({ left: 760, right: 599.5, top: 80, bottom: 30 }, row, 10)).toEqual({ first: 1, last: 3 })
  })
  it('a box that starts on the first pixel past the rows does not', () => {
    expect(rowsInBox({ left: 600, right: 760, top: 30, bottom: 80 }, row, 10)).toBeNull()
  })
  it('a box that ends on the left edge of the rows does not reach them', () => {
    expect(rowsInBox({ left: 0, right: 40, top: 30, bottom: 80 }, inset, 10)).toBeNull()
    expect(rowsInBox({ left: 0, right: 41, top: 30, bottom: 80 }, inset, 10)).toEqual({ first: 1, last: 3 })
  })
  it('a box across the rows marks what it spans vertically, as before', () => {
    expect(rowsInBox({ left: 100, right: 300, top: 30, bottom: 80 }, row, 10)).toEqual({ first: 1, last: 3 })
  })
  it('a box over the rows horizontally but below the last row marks nothing', () => {
    expect(rowsInBox({ left: 100, right: 300, top: 300, bottom: 400 }, row, 10)).toBeNull()
  })
  it('a pure vertical drag inside the rows still marks', () => {
    expect(rowsInBox({ left: 200, right: 200, top: 30, bottom: 80 }, row, 10)).toEqual({ first: 1, last: 3 })
  })
  it('works by arithmetic for rows far outside the view (virtual lists)', () => {
    expect(
      rowsInBox({ left: 10, right: 20, top: 26 * 5000, bottom: 26 * 5002 + 1 }, row, 100000)
    ).toEqual({ first: 5000, last: 5002 })
    expect(
      rowsInBox({ left: 610, right: 620, top: 26 * 5000, bottom: 26 * 5002 + 1 }, row, 100000)
    ).toBeNull()
  })
})

describe('nearestRow', () => {
  it('clamps the pointer row into the swept range', () => {
    expect(nearestRow(60, 26, 0, 5)).toBe(2)
    expect(nearestRow(-10, 26, 1, 5)).toBe(1)
    expect(nearestRow(999, 26, 1, 5)).toBe(5)
  })
})

describe('edgeSpeed', () => {
  it('is still in the middle of the list', () => {
    expect(edgeSpeed(300, 0, 600)).toBe(0)
  })
  it('scrolls up near the top and down near the bottom', () => {
    expect(edgeSpeed(10, 0, 600)).toBeLessThan(0)
    expect(edgeSpeed(590, 0, 600)).toBeGreaterThan(0)
  })
  it('ramps with depth into the edge and caps past it', () => {
    const shallow = edgeSpeed(600 - 30, 0, 600)
    const deep = edgeSpeed(600 - 5, 0, 600)
    expect(deep).toBeGreaterThan(shallow)
    expect(edgeSpeed(900, 0, 600, 36, 22)).toBe(22)
    expect(edgeSpeed(-300, 0, 600, 36, 22)).toBe(-22)
  })
  it('a list shorter than two edges still has a middle', () => {
    expect(edgeSpeed(50, 0, 100)).toBe(0)
    expect(edgeSpeed(2, 0, 100)).toBeLessThan(0)
  })
})

describe('sweepSelect', () => {
  it('a plain sweep is exactly what it covers', () => {
    expect([...sweepSelect(new Set(), ['a', 'b'])]).toEqual(['a', 'b'])
  })
  it('a ctrl sweep adds to what was marked, and shrinking gives rows back', () => {
    const base = new Set(['x'])
    expect([...sweepSelect(base, ['a', 'b', 'c'])].sort()).toEqual(['a', 'b', 'c', 'x'])
    expect([...sweepSelect(base, ['a'])].sort()).toEqual(['a', 'x'])
    expect([...base]).toEqual(['x'])
  })
})

describe('bandBox, onRowOwnPart, sameHits', () => {
  it('normalises a band dragged up and left', () => {
    expect(bandBox({ x0: 50, y0: 80, x1: 10, y1: 20 })).toEqual({
      left: 10,
      top: 20,
      width: 40,
      height: 60
    })
  })
  it('gives the row everything up to the end of its name, gaps included', () => {
    const icon = { right: 14 }
    const name = { right: 90 }
    expect(onRowOwnPart(-4, [icon, name])).toBe(true)
    expect(onRowOwnPart(5, [icon, name])).toBe(true)
    expect(onRowOwnPart(17, [icon, name])).toBe(true)
    expect(onRowOwnPart(90, [icon, name])).toBe(true)
    expect(onRowOwnPart(91, [icon, name])).toBe(false)
    expect(onRowOwnPart(5, [])).toBe(false)
  })
  it('compares hit lists', () => {
    expect(sameHits(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameHits(['a', 'b'], ['a'])).toBe(false)
  })
})
