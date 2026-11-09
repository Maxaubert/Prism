import type { JSX, ReactNode } from 'react'
import { GRID_PAD, cellRect, type GridLayout } from '../../lib/gridLayout'
import './grid.css'

/**
 * THE GRID'S LAYER (zoom steps 5 to 9, Stage 4, 2026-11-09; spec 5.1). The
 * list renders this in place of its row block for a plain folder listing at a
 * tile step. It is geometry only: the lines `firstRow` up to the window's end
 * are mounted (their items are `entries`, from `firstItem`), each tile
 * absolutely placed from `cellRect`, keyed by path so a scroll recycles DOM
 * and a picture already decoded is not decoded again. Everything that is not
 * geometry (marks, focus, drag, drop, menus, landing) is BrowseList's, passed
 * to `tile`.
 *
 * The layer is moved down to its first line the way the row layer is (the
 * `translateY` the caller computes), so a tile's `top` is its place within the
 * mounted lines.
 */
export function BrowseGrid<T extends { path: string }>({
  layout,
  firstRow,
  firstItem,
  entries,
  translateY,
  tile
}: {
  layout: GridLayout
  firstRow: number
  firstItem: number
  entries: ReadonlyArray<T | null | undefined>
  translateY: number
  tile: (entry: T, index: number, rect: { x: number; y: number; w: number; h: number }) => ReactNode
}): JSX.Element {
  // The first mounted line's top within the space, taken off every cell so the
  // tiles are placed in the translated layer's own coordinates.
  const origin = GRID_PAD + firstRow * layout.pitch
  return (
    <div className="browse-row-layer browse-grid-layer" style={{ transform: `translateY(${translateY}px)` }}>
      {entries.map((entry, offset) => {
        if (!entry) return null
        const index = firstItem + offset
        const r = cellRect(layout, index)
        return tile(entry, index, { x: r.x, y: r.y - origin + GRID_PAD, w: r.w, h: r.h })
      })}
    </div>
  )
}
