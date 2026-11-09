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

  it('never scrolls past either end', () => {
    expect(anchorScroll({ index: 0, within: 0, pointerY: 300, cellH: 76, count, viewH })).toBe(0)
    expect(anchorScroll({ index: 4999, within: 0.9, pointerY: 0, cellH: 76, count, viewH })).toBe(count * 76 - viewH)
    expect(anchorScroll({ index: 3, within: 0, pointerY: 0, cellH: 76, count: 2, viewH })).toBe(0)
  })
})
