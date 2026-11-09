import { describe, expect, it } from 'vitest'
import { anchorAt, anchorScroll } from './zoomAnchor'

// The row under the pointer stays under it when the rows change height.
describe('zoom anchor', () => {
  const heights = [22, 26, 40, 56, 76]
  const count = 5000
  const viewH = 600

  it('finds the row under the pointer and how far down it', () => {
    expect(anchorAt({ top: 1000, pointerY: 50, cellH: 40, count })).toEqual({ index: 26, within: 0.25 })
  })

  it('blank space under the last row anchors on the last one', () => {
    const a = anchorAt({ top: 0, pointerY: 500, cellH: 40, count: 3 })
    expect(a.index).toBe(2)
  })

  it('keeps the item under a fixed pointer across every pair of steps', () => {
    for (const from of heights)
      for (const to of heights)
        for (const index of [0, 1, 7, 100, 2500, 4999])
          for (const pointerY of [0, 17, 300, 599]) {
            const top = Math.min(count * from - viewH, Math.max(0, index * from - pointerY + 5))
            const a = anchorAt({ top, pointerY, cellH: from, count })
            const next = anchorScroll({ ...a, pointerY, cellH: to, count, viewH })
            const contentH = count * to
            const clamped = next === 0 || next === contentH - viewH
            const back = anchorAt({ top: next, pointerY, cellH: to, count })
            if (!clamped) {
              const y = (back.index + back.within) * to - next
              const was = (a.index + a.within) * from - top
              expect(Math.abs(y - was), `${from}->${to} @${index}`).toBeLessThanOrEqual(1)
              expect(back.index).toBe(a.index)
            }
          }
  })

  it('a grid keeps the item under a fixed pointer, going list to grid and back', () => {
    // A list row is 40px; a grid line is `cellH` (the pitch) tall with `cols` items and a lead above.
    const list = { cellH: 40, cols: 1, lead: 0 }
    const grids = [
      { cellH: 124, cols: 14, lead: 12 },
      { cellH: 316, cols: 4, lead: 12 },
      { cellH: 172, cols: 9, lead: 12 }
    ]
    for (const a of [list, ...grids])
      for (const b of [list, ...grids])
        for (const index of [0, 5, 400, 2999])
          for (const pointerY of [0, 33, 350, 599]) {
            const rowA = Math.floor(index / a.cols)
            const want = a.lead + rowA * a.cellH + 0.3 * a.cellH - pointerY
            if (want < 0) continue // the list cannot scroll above its top: the pointer is not on this item
            const here = anchorAt({ top: want, pointerY, count, ...a, col: index % a.cols })
            expect(here.index, `${a.cols}->${b.cols}`).toBe(index)
            const next = anchorScroll({ ...here, pointerY, count, viewH, ...b })
            const rowB = Math.floor(index / b.cols)
            const contentH = 2 * b.lead + Math.ceil(count / b.cols) * b.cellH
            const clamped = next === 0 || next === contentH - viewH
            if (!clamped) {
              const y = b.lead + rowB * b.cellH + here.within * b.cellH - next
              expect(Math.abs(y - pointerY), `${a.cols}->${b.cols} @${index}`).toBeLessThanOrEqual(1)
            }
          }
  })

  it('above the first line it anchors on the first item, and a column past the last item on the last', () => {
    expect(anchorAt({ top: 0, pointerY: 3, cellH: 124, count: 100, cols: 5, lead: 12, col: 2 }).index).toBe(2)
    expect(anchorAt({ top: 0, pointerY: 12 + 124 * 19 + 5, cellH: 124, count: 98, cols: 5, lead: 12, col: 4 }).index).toBe(97)
  })

  it('never scrolls past either end', () => {
    expect(anchorScroll({ index: 0, within: 0, pointerY: 300, cellH: 76, count, viewH })).toBe(0)
    expect(anchorScroll({ index: 4999, within: 0.9, pointerY: 0, cellH: 76, count, viewH })).toBe(count * 76 - viewH)
    expect(anchorScroll({ index: 3, within: 0, pointerY: 0, cellH: 76, count: 2, viewH })).toBe(0)
  })
})
