// The sweep rectangle (#257), pure. Shared by the Explorer's file list and the
// project tree. Both lists are VIRTUAL (only the rows in view exist), so a row
// is found by its index and the fixed row height, never by asking the page
// which elements the rectangle covers: a row scrolled out of view has no
// element, and it is still inside the rectangle.

/** The rectangle, in the list's own coordinates: y is measured from the top
 *  of row 0, so it does not move when the list scrolls. */
export interface Band {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** How far the pointer must travel before a press becomes a sweep. Below it a
 *  press is a click and keeps everything a click does today. */
export const SWEEP_THRESHOLD = 4

export function bandBox(b: Band): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.min(b.x0, b.x1),
    top: Math.min(b.y0, b.y1),
    width: Math.abs(b.x1 - b.x0),
    height: Math.abs(b.y1 - b.y0)
  }
}

/** The first and last row index the span top..bottom touches, or null when it
 *  touches none (all of it above row 0, or below the last row). A row counts
 *  as soon as the span overlaps it at all, as Explorer's does. */
export function rowsInBand(
  top: number,
  bottom: number,
  rowH: number,
  count: number
): { first: number; last: number } | null {
  if (!count || rowH <= 0) return null
  const lo = Math.min(top, bottom)
  const hi = Math.max(top, bottom)
  const end = count * rowH
  if (hi < 0 || lo >= end) return null
  const first = Math.max(0, Math.floor(lo / rowH))
  const last = Math.min(count - 1, Math.floor(Math.max(lo, hi - 0.001) / rowH))
  return first <= last ? { first, last } : null
}

/** The row nearest a point, clamped into first..last: the one the keyboard
 *  carries on from once the sweep ends. */
export function nearestRow(y: number, rowH: number, first: number, last: number): number {
  return Math.min(last, Math.max(first, Math.floor(y / rowH)))
}

/**
 * Pixels to scroll this frame while the pointer is near (or past) an edge of
 * the list: negative scrolls up. Nothing in the middle; inside the band of
 * `edge` pixels it ramps from 0 to `max`, and past the edge it is `max`, so
 * holding the pointer above the window keeps the list moving.
 */
export function edgeSpeed(y: number, top: number, bottom: number, edge = 36, max = 22): number {
  if (bottom - top <= 2 * edge) edge = Math.max(1, (bottom - top) / 4)
  if (y < top + edge) return -Math.round(max * Math.min(1, (top + edge - y) / edge))
  if (y > bottom - edge) return Math.round(max * Math.min(1, (y - (bottom - edge)) / edge))
  return 0
}

/** A sweep's selection: what it covers now, plus what was marked before it
 *  when it was a Ctrl sweep. Shrinking the rectangle gives rows back, since
 *  the base is fixed when the sweep starts, not grown as it goes. */
export function sweepSelect(base: ReadonlySet<string>, hits: readonly string[]): Set<string> {
  const out = new Set(base)
  for (const h of hits) out.add(h)
  return out
}

/** Is a press at x on the row's own part? Everything from the row's left edge
 *  to the right edge of its last leading box (chevron, icon, name) is the
 *  row's: a press there clicks or drags the file. Only the space past the
 *  name sweeps. Testing each box on its own left the gaps between them, the
 *  padding and the indent as sweep ground, so a drag from a hair beside the
 *  icon drew a rectangle instead of carrying the file (review of #257). */
export function onRowOwnPart(x: number, rects: Iterable<{ right: number }>): boolean {
  let end = -Infinity
  for (const r of rects) end = Math.max(end, r.right)
  return x <= end
}

/** Two hit lists the same? Saves a render per pointer move that changed nothing. */
export function sameHits(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i])
}
