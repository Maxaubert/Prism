// KEEPING THE ITEM UNDER THE POINTER (owner, 2026-11-09: Ctrl+scroll zoom).
// When the cells change size the list would otherwise stay at the same scroll
// offset and the item you were pointing at would slide away. So before the
// change we note WHICH item is under the pointer and how far down its cell the
// pointer is, and after the change we scroll so that item is under the
// pointer again. Pure: the list reads and writes the numbers.
//
// `cols` is 1 for a list; a grid puts several items in a line of cells, and
// the item, not the line, is what stays under the pointer. `col` is the
// column under the pointer (from its x), `lead` the padding above the first
// line and below the last (the grid has 12px, a list none). `cellH` is the
// pitch: a line of cells and the gap under it.

export interface Anchor {
  /** The item under the pointer, or the nearest one over blank space. */
  index: number
  /** How far down its cell the pointer is, 0 to 1. */
  within: number
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** The item under `pointerY` (measured from the list's top edge) when the
 *  list is scrolled to `top`. In a compressed scroll space pass the LOGICAL
 *  top (`logicalTopAt`), as the keyboard's scroll-into-view does. */
export function anchorAt(a: {
  top: number
  pointerY: number
  cellH: number
  count: number
  cols?: number
  col?: number
  lead?: number
}): Anchor {
  const cols = a.cols ?? 1
  const y = a.top + a.pointerY - (a.lead ?? 0)
  const row = Math.max(0, Math.floor(y / a.cellH))
  const index = clamp(row * cols + clamp(a.col ?? 0, 0, cols - 1), 0, Math.max(0, a.count - 1))
  const itemRow = Math.floor(index / cols)
  return { index, within: clamp((y - itemRow * a.cellH) / a.cellH, 0, 1) }
}

/** The scroll offset that puts `index` back under `pointerY` once cells are
 *  `cellH` tall, never past either end. */
export function anchorScroll(
  a: Anchor & { pointerY: number; cellH: number; count: number; viewH: number; cols?: number; lead?: number }
): number {
  const cols = a.cols ?? 1
  const lead = a.lead ?? 0
  const row = Math.floor(a.index / cols)
  const contentH = 2 * lead + Math.ceil(a.count / cols) * a.cellH
  return clamp(lead + row * a.cellH + a.within * a.cellH - a.pointerY, 0, Math.max(0, contentH - a.viewH))
}
