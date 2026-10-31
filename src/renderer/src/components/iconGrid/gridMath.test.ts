import { describe, expect, it } from 'vitest'
import { cellOf, columnsFor, drawnCell, enterPick, moveIndex, rowCount, scrollFor, visibleRows } from './gridMath'

describe('icon grid maths', () => {
  it('columns from the width, never none', () => {
    expect(columnsFor(400, 40)).toBe(10)
    expect(columnsFor(439, 40)).toBe(10)
    expect(columnsFor(10, 40)).toBe(1)
    expect(columnsFor(0, 40)).toBe(1)
  })

  it('rows for a count', () => {
    expect(rowCount(2024, 10)).toBe(203)
    expect(rowCount(0, 10)).toBe(0)
    expect(rowCount(10, 10)).toBe(1)
    expect(rowCount(11, 10)).toBe(2)
  })

  it('rows in view plus 3 of overscan, clamped to the list', () => {
    expect(visibleRows(0, 320, 40, 203)).toEqual({ first: 0, end: 11 })
    expect(visibleRows(4000, 320, 40, 203)).toEqual({ first: 97, end: 111 })
    expect(visibleRows(203 * 40 - 320, 320, 40, 203)).toEqual({ first: 192, end: 203 })
    expect(visibleRows(0, 320, 40, 0)).toEqual({ first: 0, end: 0 })
    // A bounded band whatever the count.
    const band = visibleRows(123456, 320, 40, 100000)
    expect(band.end - band.first).toBeLessThanOrEqual(15)
  })

  it('index to row and column', () => {
    expect(cellOf(0, 10)).toEqual({ row: 0, col: 0 })
    expect(cellOf(23, 10)).toEqual({ row: 2, col: 3 })
  })

  it('scrolls only as far as needed to show a cell', () => {
    expect(scrollFor(5, 10, 40, 0, 320)).toBe(0)
    expect(scrollFor(95, 10, 40, 0, 320)).toBe(9 * 40 + 40 - 320)
    expect(scrollFor(5, 10, 40, 200, 320)).toBe(0)
    expect(scrollFor(55, 10, 40, 100, 320)).toBe(100)
  })

  it('keys move one cell, a row end, the list end or a page, and never leave it', () => {
    const m = (i: number, key: string, ctrl = false): number | undefined => moveIndex(i, key, 10, 25, 8, ctrl)
    expect(m(0, 'ArrowRight')).toBe(1)
    expect(m(0, 'ArrowLeft')).toBe(0)
    expect(m(9, 'ArrowRight')).toBe(10)
    expect(m(3, 'ArrowDown')).toBe(13)
    expect(m(13, 'ArrowDown')).toBe(23)
    expect(m(17, 'ArrowDown')).toBe(17)
    expect(m(3, 'ArrowUp')).toBe(3)
    expect(m(13, 'Home')).toBe(10)
    expect(m(13, 'End')).toBe(19)
    expect(m(21, 'End')).toBe(24)
    expect(m(13, 'Home', true)).toBe(0)
    expect(m(3, 'End', true)).toBe(24)
    expect(m(3, 'PageDown')).toBe(24)
    expect(m(24, 'PageUp')).toBe(0)
    expect(m(3, 'x')).toBeUndefined()
    expect(moveIndex(0, 'ArrowRight', 10, 0, 8)).toBeUndefined()
  })

  it('a screen reader is pointed only at a cell that is drawn', () => {
    // 10 columns, rows 3..8 in the DOM: cells 30..89.
    expect(drawnCell(30, 10, 3, 9, 200)).toBe(true)
    expect(drawnCell(89, 10, 3, 9, 200)).toBe(true)
    expect(drawnCell(29, 10, 3, 9, 200)).toBe(false)
    expect(drawnCell(90, 10, 3, 9, 200)).toBe(false)
    expect(drawnCell(-1, 10, 3, 9, 200)).toBe(false)
    expect(drawnCell(50, 10, 3, 9, 40)).toBe(false)
  })

  it('Enter in the field: the active cell, the best hit typed, and nothing on a blank field', () => {
    const best = (q: string): number | undefined => (q === 'cam' ? 7 : 0)
    // Typed and the list caught up: the active cell.
    expect(enterPick({ query: 'cam', deferred: 'cam', active: 2, best })).toEqual({ list: 2 })
    // A key behind: the best hit of what the field says now.
    expect(enterPick({ query: 'cam', deferred: 'ca', active: 2, best })).toEqual({ set: 7 })
    // Blank, nothing active: an Enter on open picks nothing (review: it used to give Home).
    expect(enterPick({ query: '', deferred: '', active: -1, best })).toBeNull()
    expect(enterPick({ query: '  ', deferred: '  ', active: -1, best })).toBeNull()
    // Blank with the folder's icon active: Enter keeps it.
    expect(enterPick({ query: '', deferred: '', active: 4, best })).toEqual({ list: 4 })
  })
})
