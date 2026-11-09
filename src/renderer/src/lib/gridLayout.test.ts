import { describe, expect, it } from 'vitest'
import { GRID_GAP, GRID_PAD, TILE_PAD, cellRect, gridLayout, indexAt, nameBand, rowsWindow } from './gridLayout'

// The grid is fixed-size, left-aligned cells (zoom grid spec 5.1): geometry is
// pure maths, so a pixel meets an index in exactly these functions.
describe('grid layout', () => {
  const base = { count: 10_000, edge: 96, font: 11.5 }

  it('a cell is the picture, a pad each side, and the name band under it', () => {
    const l = gridLayout({ ...base, width: 1500 })
    expect(l.cellW).toBe(96 + 2 * TILE_PAD)
    expect(l.cellH).toBe(96 + nameBand(11.5))
    expect(l.pitch).toBe(l.cellH + GRID_GAP)
  })

  it('columns follow the width: as many whole cells as fit between the paddings', () => {
    for (const width of [200, 360, 640, 900, 1500, 2400]) {
      const l = gridLayout({ ...base, width })
      const fit = Math.max(1, Math.floor((width - 2 * GRID_PAD + GRID_GAP) / (l.cellW + GRID_GAP)))
      expect(l.cols, `${width}`).toBe(fit)
      if (l.cols > 1 || width >= l.cellW + 2 * GRID_PAD)
        expect(GRID_PAD + l.cols * l.cellW + (l.cols - 1) * GRID_GAP).toBeLessThanOrEqual(width - GRID_PAD)
    }
    expect(gridLayout({ ...base, width: 10 }).cols).toBe(1)
  })

  it('rows and the scroll height cover every item, with the padding above and below', () => {
    const l = gridLayout({ ...base, count: 101, width: 640 })
    expect(l.rows).toBe(Math.ceil(101 / l.cols))
    expect(l.contentH).toBe(2 * GRID_PAD + l.rows * l.pitch)
    expect(gridLayout({ ...base, count: 0, width: 640 }).rows).toBe(0)
    expect(gridLayout({ ...base, count: 0, width: 640 }).contentH).toBe(2 * GRID_PAD)
  })

  it('cellRect and indexAt are inverses, and the gaps and margins hit nothing', () => {
    const l = gridLayout({ ...base, count: 1234, width: 900 })
    for (const i of [0, 1, l.cols - 1, l.cols, 77, 1233]) {
      const r = cellRect(l, i)
      expect(indexAt(l, r.x, r.y), `${i} top-left`).toBe(i)
      expect(indexAt(l, r.x + r.w - 1, r.y + r.h - 1), `${i} bottom-right`).toBe(i)
      expect(indexAt(l, r.x + r.w / 2, r.y + r.h / 2), `${i} middle`).toBe(i)
      expect(indexAt(l, r.x + r.w + 1, r.y + 1) === i, `${i} gap`).toBe(false)
    }
    const r0 = cellRect(l, 0)
    expect(indexAt(l, r0.x + r0.w + GRID_GAP / 2, r0.y + 5)).toBeNull()
    expect(indexAt(l, 1, 1)).toBeNull()
    expect(indexAt(l, r0.x + 1, r0.y + r0.h + GRID_GAP / 2)).toBeNull()
    // Past the last item in the last row, and past the right margin.
    const last = cellRect(l, 1233)
    expect(indexAt(l, last.x + last.w + GRID_GAP + 3, last.y + 3)).toBeNull()
    expect(indexAt(l, 899, r0.y + 3)).toBeNull()
  })

  it('the window is the visible rows plus the overscan, and a tile count bounded by it', () => {
    const viewH = 700
    for (const edge of [96, 128, 168, 216, 272])
      for (const width of [300, 700, 1500]) {
        const l = gridLayout({ count: 10_000, edge, font: 12, width })
        for (const top of [0, 1, 999, 50_000, l.contentH - viewH]) {
          const w = rowsWindow(l, top, viewH, 2)
          expect(w.first % l.cols).toBe(0)
          expect(w.end - w.first).toBeLessThanOrEqual((viewH / l.pitch + 6) * l.cols)
          // Every row that shows is inside the window.
          const firstShown = Math.max(0, Math.floor((top - GRID_PAD) / l.pitch))
          const lastShown = Math.min(l.rows - 1, Math.floor((top + viewH - GRID_PAD) / l.pitch))
          expect(Math.floor(w.first / l.cols)).toBeLessThanOrEqual(firstShown)
          expect(Math.ceil(w.end / l.cols)).toBeGreaterThanOrEqual(lastShown + 1)
        }
      }
  })

  it('the window at the end stops at the last item', () => {
    const l = gridLayout({ count: 101, edge: 96, font: 11.5, width: 640 })
    const w = rowsWindow(l, l.contentH, 600, 2)
    expect(w.end).toBe(101)
    expect(w.first).toBeLessThanOrEqual(101)
  })

  it('an empty grid has an empty window', () => {
    const l = gridLayout({ count: 0, edge: 96, font: 11.5, width: 640 })
    expect(rowsWindow(l, 0, 600, 2)).toEqual({ firstRow: 0, endRow: 0, first: 0, end: 0 })
  })

  it('10,000 and 1,000,000 items stay finite, and 10,000 stay under the 4,000,000px safety net', () => {
    const small = gridLayout({ count: 10_000, edge: 96, font: 11.5, width: 1500 })
    expect(small.contentH).toBeLessThan(4_000_000)
    const big = gridLayout({ count: 10_000, edge: 272, font: 13, width: 1500 })
    expect(big.cols).toBeGreaterThanOrEqual(4)
    expect(big.contentH).toBeLessThan(4_000_000)
    const huge = gridLayout({ count: 1_000_000, edge: 272, font: 13, width: 1500 })
    expect(Number.isFinite(huge.contentH)).toBe(true)
    expect(huge.rows).toBe(Math.ceil(1_000_000 / huge.cols))
    const w = rowsWindow(huge, 1_000_000, 700, 2)
    expect(w.end - w.first).toBeLessThanOrEqual((700 / huge.pitch + 6) * huge.cols)
  })

  it('the name band holds two lines of the font', () => {
    expect(nameBand(13)).toBeGreaterThanOrEqual(2 * Math.ceil(13 * 1.35))
    expect(nameBand(13)).toBeGreaterThan(nameBand(11.5))
  })
})
