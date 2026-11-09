import { describe, expect, it } from 'vitest'
import { GRID_GAP, GRID_PAD, cellRect, gridLayout } from './gridLayout'
import { cellSpan, cellsInBox, nearestCell } from './cellsInBox'

// The grid's sweep (zoom grid spec 5.4): the tiles whose RECT (the cell, name
// band included, minus the gap) the box touches, by column and row spans.
describe('cellsInBox', () => {
  const l = gridLayout({ width: 700, count: 23, edge: 96, font: 11.5 })
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })
  const rect = (i: number) => cellRect(l, i)

  it('the layout under test has several columns and rows', () => {
    expect(l.cols).toBeGreaterThan(2)
    expect(l.rows).toBeGreaterThan(2)
  })

  it('a box inside one tile selects that tile, and its name band counts', () => {
    const r = rect(4)
    expect(cellsInBox(box(r.x + 5, r.y + 5, r.x + 9, r.y + 9), l)).toEqual([4])
    expect(cellsInBox(box(r.x + 5, r.y + r.h - 3, r.x + 9, r.y + r.h - 1), l)).toEqual([4])
  })

  it('a box over a gap, the padding or a right margin selects nothing', () => {
    const r = rect(0)
    expect(cellsInBox(box(r.x + r.w + 1, r.y + 3, r.x + r.w + GRID_GAP - 1, r.y + 9), l)).toEqual([])
    expect(cellsInBox(box(r.x + 3, r.y + r.h + 1, r.x + 9, r.y + r.h + GRID_GAP - 1), l)).toEqual([])
    expect(cellsInBox(box(0, 0, GRID_PAD - 1, GRID_PAD - 1), l)).toEqual([])
    const last = rect(l.cols - 1)
    expect(cellsInBox(box(last.x + last.w + 1, last.y, 10_000, last.y + 20), l)).toEqual([])
  })

  it('one pixel of overlap counts, and an edge that only meets the cell does not', () => {
    const r = rect(1)
    expect(cellsInBox(box(r.x - 20, r.y + 4, r.x + 1, r.y + 8), l)).toContain(1)
    expect(cellsInBox(box(r.x - 20, r.y + 4, r.x, r.y + 8), l)).not.toContain(1)
    expect(cellsInBox(box(r.x + r.w - 1, r.y + 4, r.x + r.w + 30, r.y + 8), l)).toContain(1)
    expect(cellsInBox(box(r.x + r.w, r.y + 4, r.x + r.w + 1, r.y + 8), l)).not.toContain(1)
  })

  it('a box with no width or height still marks where it stands', () => {
    const r = rect(5)
    expect(cellsInBox(box(r.x + 10, r.y + 10, r.x + 10, r.y + 10), l)).toEqual([5])
  })

  it('spans over columns and rows give the rectangle of cells, either way round', () => {
    const a = rect(1)
    const b = rect(l.cols + 2)
    const want = [1, 2, l.cols + 1, l.cols + 2]
    expect(cellsInBox(box(a.x + 4, a.y + 4, b.x + 4, b.y + 4), l)).toEqual(want)
    expect(cellsInBox(box(b.x + 4, b.y + 4, a.x + 4, a.y + 4), l)).toEqual(want)
  })

  it('never names an item past the last, in a short last line', () => {
    const lastLine = (l.rows - 1) * l.cols
    const got = cellsInBox(box(0, rect(lastLine).y, 5000, 5000), l)
    expect(Math.max(...got)).toBe(22)
    expect(cellsInBox(box(0, 0, 5000, 5000), l)).toHaveLength(23)
  })

  it('a box above, below or beside everything is null', () => {
    expect(cellSpan(box(0, -50, 5000, -1), l)).toBeNull()
    expect(cellSpan(box(0, l.contentH + 5, 5000, l.contentH + 50), l)).toBeNull()
    expect(cellSpan(box(0, 0, 5000, 5000), gridLayout({ width: 700, count: 0, edge: 96, font: 11.5 }))).toBeNull()
  })

  it('is a span computation: 10,000 items cost the columns by the lines touched, not a scan', () => {
    const big = gridLayout({ width: 1500, count: 10_000, edge: 96, font: 11.5 })
    const top = big.pitch * 400 + 20
    const span = cellSpan(box(0, top, 5000, big.pitch * 402), big)
    expect(span).not.toBeNull()
    expect(span!.lastRow - span!.firstRow).toBeLessThanOrEqual(2)
    expect(cellsInBox(box(0, top, 5000, big.pitch * 402), big).length).toBeLessThanOrEqual(3 * big.cols)
    expect(cellsInBox(box(0, 0, 100000, big.contentH), big)).toHaveLength(10_000)
  })

  it('nearestCell clamps the pointer into the span: the keyboard carries on from there', () => {
    const a = rect(1)
    const b = rect(l.cols + 2)
    const span = cellSpan(box(a.x + 4, a.y + 4, b.x + 4, b.y + 4), l)!
    expect(nearestCell(l, b.x + 4, b.y + 4, span)).toBe(l.cols + 2)
    expect(nearestCell(l, a.x + 4, a.y + 4, span)).toBe(1)
    expect(nearestCell(l, 5000, 5000, span)).toBe(l.cols + 2)
    expect(nearestCell(l, 0, 0, span)).toBe(1)
  })
})
