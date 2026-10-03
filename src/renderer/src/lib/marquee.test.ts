import { describe, expect, it } from 'vitest'
import {
  bandBox,
  edgeSpeed,
  inAnyRect,
  nearestRow,
  rowsInBand,
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

describe('bandBox, inAnyRect, sameHits', () => {
  it('normalises a band dragged up and left', () => {
    expect(bandBox({ x0: 50, y0: 80, x1: 10, y1: 20 })).toEqual({ left: 10, top: 20, width: 40, height: 60 })
  })
  it('finds a point in any of several boxes', () => {
    const icon = { left: 0, top: 0, right: 14, bottom: 14 }
    const name = { left: 20, top: 0, right: 90, bottom: 14 }
    expect(inAnyRect(5, 5, [icon, name])).toBe(true)
    expect(inAnyRect(50, 7, [icon, name])).toBe(true)
    expect(inAnyRect(120, 7, [icon, name])).toBe(false)
  })
  it('compares hit lists', () => {
    expect(sameHits(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameHits(['a', 'b'], ['a'])).toBe(false)
  })
})
