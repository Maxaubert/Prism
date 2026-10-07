import { describe, expect, it } from 'vitest'
import {
  bandBox,
  edgeSpeed,
  onRowOwnPart,
  nearestRow,
  rowsInBand,
  rowsInBox,
  sameHits,
  sweepSelect
} from './marquee'

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
