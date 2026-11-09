// THE GRID'S GEOMETRY (zoom grid, Stage 4, 2026-11-09; spec 5.1). Cells are a
// fixed size and left-aligned (no stretch, so the maths is deterministic and
// testable; leftover width is a margin on the right, as Explorer does). These
// few functions are the only places a pixel meets an index: the list draws,
// scrolls, anchors and finds the item under a point through them.
//
// Coordinates are the scroll content's own: y = 0 is the top of the scrolled
// space, GRID_PAD above the first line.

/** The list's padding on every side. */
export const GRID_PAD = 12
/** The gap between cells, both ways. */
export const GRID_GAP = 4
/** The space round a tile's picture inside its cell, left and right and above. */
export const TILE_PAD = 6

/** The text line height: the font times 1.35, whole pixels. */
const lineOf = (font: number): number => Math.ceil(font * 1.35)

/** What sits under the picture inside a cell: the gap above the name (the
 *  pad), two lines of name, and a little under them. */
export function nameBand(font: number): number {
  return TILE_PAD + 2 * lineOf(font) + 8
}

export interface GridLayout {
  count: number
  cols: number
  /** The picture's edge. */
  edge: number
  cellW: number
  cellH: number
  /** One line of cells: the cell and the gap under it. */
  pitch: number
  rows: number
  /** The whole scrolled space, the padding above and below included. */
  contentH: number
}

export function gridLayout(a: { width: number; count: number; edge: number; font: number }): GridLayout {
  const cellW = a.edge + 2 * TILE_PAD
  const cellH = a.edge + nameBand(a.font)
  const pitch = cellH + GRID_GAP
  const cols = Math.max(1, Math.floor((a.width - 2 * GRID_PAD + GRID_GAP) / (cellW + GRID_GAP)))
  const rows = Math.ceil(a.count / cols)
  return { count: a.count, cols, edge: a.edge, cellW, cellH, pitch, rows, contentH: 2 * GRID_PAD + rows * pitch }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Where item `index`'s cell is, in the scrolled space. */
export function cellRect(l: GridLayout, index: number): Rect {
  const col = index % l.cols
  const row = Math.floor(index / l.cols)
  return { x: GRID_PAD + col * (l.cellW + GRID_GAP), y: GRID_PAD + row * l.pitch, w: l.cellW, h: l.cellH }
}

/** The item whose cell holds the point, or null on a gap, a margin, the
 *  padding, or past the last item. */
export function indexAt(l: GridLayout, x: number, y: number): number | null {
  const gx = x - GRID_PAD
  const gy = y - GRID_PAD
  if (gx < 0 || gy < 0) return null
  const col = Math.floor(gx / (l.cellW + GRID_GAP))
  const row = Math.floor(gy / l.pitch)
  if (col >= l.cols || gx - col * (l.cellW + GRID_GAP) >= l.cellW) return null
  if (gy - row * l.pitch >= l.cellH) return null
  const index = row * l.cols + col
  return index < l.count ? index : null
}

export interface RowsWindow {
  firstRow: number
  endRow: number
  /** The first item mounted (a line's first) and one past the last. */
  first: number
  end: number
}

/** The lines to mount for a scroll position: the ones in view and `overscan`
 *  more at each end. */
export function rowsWindow(l: GridLayout, top: number, viewH: number, overscan: number): RowsWindow {
  if (l.rows === 0) return { firstRow: 0, endRow: 0, first: 0, end: 0 }
  const seen = Math.floor((top - GRID_PAD) / l.pitch)
  const lastSeen = Math.ceil((top + viewH - GRID_PAD) / l.pitch)
  const firstRow = Math.min(l.rows, Math.max(0, seen - overscan))
  const endRow = Math.max(firstRow, Math.min(l.rows, lastSeen + overscan))
  return { firstRow, endRow, first: firstRow * l.cols, end: Math.min(l.count, endRow * l.cols) }
}
