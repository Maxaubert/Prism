import { GRID_GAP, GRID_PAD, type GridLayout } from './gridLayout'
import type { SweepBox } from './marquee'

// THE GRID'S SWEEP, pure (zoom grid Stage 6, 2026-11-10; spec 5.4). The list
// asks which ROWS a box touches (`rowsInBox`); the grid asks which TILES. A
// tile is its cell minus the gap, name band included, so a box in a gap
// touches nothing. The answer is a span of lines and a span of columns, found
// by division, never by scanning the items: ten thousand tiles cost the lines
// the box crosses.
//
// The edge rule is the rows' own (marquee.ts): one pixel of overlap counts, an
// edge that only meets the cell does not, and a box with no size still marks
// the tile it stands in.

export interface CellSpan {
  firstRow: number
  lastRow: number
  firstCol: number
  lastCol: number
}

/** The first and last index of cells of size `cell` every `stride` from
 *  `pad` that the span lo..hi touches, within `n` of them, or null. */
function touched(lo: number, hi: number, pad: number, cell: number, stride: number, n: number): [number, number] | null {
  const a = Math.min(lo, hi)
  const b = Math.max(a, Math.max(lo, hi) - 0.001)
  // The first cell whose far edge is past `a`; the last whose near edge is
  // at or before `b`.
  const first = Math.max(0, Math.floor((a - pad - cell) / stride) + 1)
  const last = Math.min(n - 1, Math.floor((b - pad) / stride))
  return first <= last ? [first, last] : null
}

/** The lines and columns of tiles the box touches, or null when it touches
 *  none (over a gap, the padding, a right margin, or outside everything). */
export function cellSpan(box: SweepBox, l: GridLayout): CellSpan | null {
  if (l.count <= 0) return null
  const cols = touched(box.left, box.right, GRID_PAD, l.cellW, l.cellW + GRID_GAP, l.cols)
  const rows = touched(box.top, box.bottom, GRID_PAD, l.cellH, l.pitch, l.rows)
  if (!cols || !rows) return null
  return { firstRow: rows[0], lastRow: rows[1], firstCol: cols[0], lastCol: cols[1] }
}

/** The indexes of the tiles the box touches, in order. A short last line has
 *  no tile past the last item. */
export function cellsInBox(box: SweepBox, l: GridLayout): number[] {
  const span = cellSpan(box, l)
  if (!span) return []
  const out: number[] = []
  for (let r = span.firstRow; r <= span.lastRow; r++)
    for (let c = span.firstCol; c <= span.lastCol; c++) {
      const i = r * l.cols + c
      if (i < l.count) out.push(i)
    }
  return out
}

/** The tile of the span nearest a point (the pointer, in the scrolled space):
 *  the one the keyboard carries on from once the sweep ends. */
export function nearestCell(l: GridLayout, x: number, y: number, span: CellSpan): number {
  const col = Math.min(span.lastCol, Math.max(span.firstCol, Math.floor((x - GRID_PAD) / (l.cellW + GRID_GAP))))
  const row = Math.min(span.lastRow, Math.max(span.firstRow, Math.floor((y - GRID_PAD) / l.pitch)))
  return Math.min(l.count - 1, row * l.cols + col)
}
