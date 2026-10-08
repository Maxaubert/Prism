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

/** The rectangle as edges, in the list's own coordinates (either way round). */
export interface SweepBox {
  left: number
  right: number
  top: number
  bottom: number
}

/** Where a list's rows are drawn across, and how tall each one is. Every row
 *  of one list shares the across part: the Explorer's rows are one grid, the
 *  tree's run the tree's whole width. */
export interface RowShape {
  left: number
  right: number
  height: number
}

/**
 * THE BOX MARKS ONLY WHAT IT TOUCHES (#326; owner, 2026-10-07: "only the ones
 * that are inside it, even if that's a px should get marked but this is not
 * inside at all"). The rows the rectangle overlaps ACROSS and DOWN, or null.
 * Until then only the vertical span was asked, so a box drawn in the empty
 * space right of the Explorer's last column marked every row at its height.
 * A row's across part is what is DRAWN as the row, never the scroll box's
 * width. One pixel of overlap counts: a box from the row's last pixel column
 * touches it, a box from the first column past it does not. The edges follow
 * `rowsInBand`'s rule, so a box with no width still marks where it stands.
 */
export function rowsInBox(
  box: SweepBox,
  row: RowShape,
  count: number
): { first: number; last: number } | null {
  const lo = Math.min(box.left, box.right)
  const hi = Math.max(box.left, box.right)
  if (lo >= row.right || Math.max(lo, hi - 0.001) < row.left) return null
  return rowsInBand(box.top, box.bottom, row.height, count)
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

/** The rows a sweep covers, by index, and the one the pointer is nearest. */
export interface SweepSpan {
  first: number
  last: number
  near: number
}

/** Did the covered rows change? The hit set is a run of indices, so this is
 *  the whole incremental test (#332, Explorer's `_PerformItemCompare` re-tests
 *  only what moved): a move that covers the same run touches no row at all. */
export function sameSpan(a: SweepSpan | null, b: SweepSpan | null): boolean {
  if (!a || !b) return a === b
  return a.first === b.first && a.last === b.last
}

/** Is row `index` inside the span? */
export function inSpan(span: SweepSpan | null, index: number): boolean {
  return !!span && index >= span.first && index <= span.last
}

/** A point, either in a list's content (y from row 0, so it does not move
 *  when the list scrolls) or on the screen (client pixels). */
export interface Point {
  x: number
  y: number
}

/** A list's content point on screen: its content box's place on screen
 *  (`origin`) minus how far it is scrolled. And back. The anchor of a sweep is
 *  kept as content, so a scroll moves it with the rows (#332). */
export function contentToClient(p: Point, origin: Point, scroll: Point): Point {
  return { x: origin.x + p.x - scroll.x, y: origin.y + p.y - scroll.y }
}
export function clientToContent(p: Point, origin: Point, scroll: Point): Point {
  return { x: p.x - origin.x + scroll.x, y: p.y - origin.y + scroll.y }
}

/** A box on screen, in client pixels. */
export interface ClientRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** A point held to a list's visible extent plus a pixel each way, as
 *  Explorer's `OnMouseMoved` holds the marquee to its viewer (#332): past the
 *  edge the box stops at it while the list scrolls under it. */
export function clampToView(p: Point, view: ClientRect): Point {
  return {
    x: Math.min(view.right + 1, Math.max(view.left - 1, p.x)),
    y: Math.min(view.bottom + 1, Math.max(view.top - 1, p.y))
  }
}

/**
 * THE BOX IN WHOLE DEVICE PIXELS (#332; owner, 2026-10-08: the box shakes).
 * Explorer's marquee is integer geometry from one fixed corner: X = min,
 * Width = (max + 1) - min, in physical pixels. A box at fractional CSS pixels
 * has each edge snapped on its own by the compositor, so the edge that should
 * stand still flickers a device pixel as the other one moves. Here both
 * corners are rounded to the device grid first, then the box covers the
 * pixels from the lower one to the higher one, both included: the same anchor
 * gives the same edge on every frame, and a box level with the press is still
 * one device pixel thick.
 */
export function snapBox(
  a: Point,
  b: Point,
  dpr: number
): { left: number; top: number; width: number; height: number } {
  const d = dpr > 0 ? dpr : 1
  const x0 = Math.round(Math.min(a.x, b.x) * d)
  const x1 = Math.round(Math.max(a.x, b.x) * d)
  const y0 = Math.round(Math.min(a.y, b.y) * d)
  const y1 = Math.round(Math.max(a.y, b.y) * d)
  return { left: x0 / d, top: y0 / d, width: (x1 + 1 - x0) / d, height: (y1 + 1 - y0) / d }
}

/** What a row reads as while a sweep runs: covered (`on`), marked before the
 *  sweep but not covered by it (`off`, the mark it had is taken away while the
 *  box draws), or left as it is (null). */
export function sweepMark(covered: boolean, heldBefore: boolean): 'on' | 'off' | null {
  return covered ? 'on' : heldBefore ? 'off' : null
}
