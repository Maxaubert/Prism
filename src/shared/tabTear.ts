import type { SavedBrowse } from './browse'
import type { DirListing, ViewerFile } from './types'

/**
 * TAB TEAR-OFF, THE GEOMETRY (tab tear-off step 3, owner, 2026-10-29; spec
 * docs/superpowers/specs/2026-10-29-tab-tearoff-design.md section 1). Owner:
 * "if the tab is dragged outside of the tab border where it's fully outside
 * then it's a new window otherwise it snaps to the tab bar. make sure to do
 * this carefully since this is often something that can feel bad but needs
 * to feel intuitive."
 *
 * Every number the gesture feels by lives here, pure, so vitest pins it
 * (`tabTear.test.ts`) and the e2e only checks the outcome. All distances are
 * DIP (CSS pixels at zoom 1; Prism runs at 225% on the owner's display).
 *
 * - The strip (renderer) asks `shouldTear` and draws the carried tab with
 *   `ghostRect` (the 0.4x pull) while it is still attached.
 * - Main asks `stripUnder` and `dwellStep` for the snap back, and places the
 *   floating window with `floatSize` and `floatBounds`.
 */

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}
export interface Point {
  x: number
  y: number
}
export interface Size {
  width: number
  height: number
}
/** Electron's rectangle shape. */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export const TEAR = {
  /** A press becomes a drag past this (the strip's DRAG_SLOP since #70). */
  slop: 4,
  /** Out of the strip and not torn yet, the tab follows the cursor at this
   *  fraction: it visibly pulls against the bar ("pull further and it comes off"). */
  pull: 0.4,
  /** The snap-back zone is the strip's rect grown by this: tighter than the
   *  tear, so the edge cannot flicker. */
  snapMargin: 8,
  /** The cursor must stay in the snap zone this long before the tab attaches. */
  dwellMs: 120,
  /** A new window keeps this far inside the display's work area. */
  inset: 10,
  /** How often main moves the floating window (about 120 Hz). */
  tickMs: 8,
  /** The spare window is made this long after startup and after each use. */
  spareDelayMs: 2000,
  /** Of a floating window, this much always stays on the work area. */
  keepVisible: 48,
  /** A tear also needs the cursor this far out of the zone: more than the snap
   *  margin, so a tab torn off cannot be over the snap zone at that moment. */
  tearGuard: 12,
  /** A drop before a fresh window's page has drawn the tab waits this long for
   *  it; past that the window failed to load and the tab goes back. */
  lateDropMs: 10000
} as const

export const rectOf = (b: Bounds): Rect => ({ left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height })
export const grow = (r: Rect, by: number): Rect => ({
  left: r.left - by,
  top: r.top - by,
  right: r.right + by,
  bottom: r.bottom + by
})
/** Edges are inside: a cursor on the strip's last pixel row is on the strip. */
export const inside = (p: Point, r: Rect): boolean => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Has a press travelled far enough to be a drag rather than a click? */
export const pastSlop = (dx: number, dy: number, slop: number = TEAR.slop): boolean =>
  Math.max(Math.abs(dx), Math.abs(dy)) >= slop

/**
 * The zone a carried tab has to leave ENTIRELY to tear: the strip's own rect,
 * its right end at the + button plus one tab width of grace (spec 1.3). The
 * empty strip after that is not "the tab border" (the owner's word), but a
 * tab slid just past the + must not come off by accident.
 */
export function tearZone(strip: Rect, plusRight: number, tabWidth: number): Rect {
  return { left: strip.left, top: strip.top, bottom: strip.bottom, right: plusRight + tabWidth }
}

/**
 * The SNAP-BACK target main is handed (spec 1.4): the strip, but never further
 * right than the tear zone. The strip itself runs on to the window controls, so
 * a tab carried sideways past the + tears with the cursor still over the strip;
 * snapping back over the WHOLE strip would attach it again 120 ms later, tear it
 * on the next move, and so on (the window flickering, review 2026-10-29). Held
 * to the zone, a tear (12 DIP out of the zone) is always outside the snap zone
 * (8 DIP around this), whichever way the tab left.
 */
export function snapTarget(strip: Rect, zone: Rect): Rect {
  return {
    left: Math.max(strip.left, zone.left),
    top: strip.top,
    right: Math.min(strip.right, zone.right),
    bottom: strip.bottom
  }
}

/** Where the carried tab WOULD be if it followed the cursor freely: the rect
 *  the tear is judged on. `grab` is the cursor's offset inside the tab. */
export function freeRect(pointer: Point, grab: Point, size: Size): Rect {
  const left = pointer.x - grab.x
  const top = pointer.y - grab.y
  return { left, top, right: left + size.width, bottom: top + size.height }
}

/** No overlap at all; touching the edge counts as out. */
export const fullyOutside = (r: Rect, zone: Rect): boolean =>
  r.right <= zone.left || r.left >= zone.right || r.bottom <= zone.top || r.top >= zone.bottom

/**
 * THE TEAR (spec 1.3): the carried tab's rect is fully outside the zone (the
 * owner's rule), AND the cursor is `tearGuard` (12 DIP) out of the zone, more
 * than the snap margin. The second part only bites for a grab near the tab's
 * edge (a press 2 DIP from its top is fully below the strip with the cursor 2
 * DIP under it): without it the tab would tear inside the snap zone and attach
 * again at once. A press in the middle of a 32 DIP tab tears 16 DIP out.
 */
export function shouldTear(pointer: Point, grab: Point, size: Size, zone: Rect): boolean {
  return fullyOutside(freeRect(pointer, grab, size), zone) && !inside(pointer, grow(zone, TEAR.tearGuard))
}

/** How far past [lo, hi] `v` is, times the pull (0 inside). */
export function pull(v: number, lo: number, hi: number, k: number = TEAR.pull): number {
  if (v < lo) return (v - lo) * k
  if (v > hi) return (v - hi) * k
  return 0
}
/** `v` held to [lo, hi], with the overshoot coming through at the pull: a
 *  rubber band, not a wall. */
export const band = (v: number, lo: number, hi: number, k: number = TEAR.pull): number =>
  clamp(v, Math.min(lo, hi), Math.max(lo, hi)) + pull(v, Math.min(lo, hi), Math.max(lo, hi), k)

/**
 * Where the strip DRAWS the carried tab while it is still attached (spec 1.1,
 * 1.2): it slides freely along its row (clamped to the strip, as since #70),
 * and once the cursor leaves the strip vertically, or carries it past either
 * end, it follows at 0.4x. Client coordinates.
 */
export function ghostRect(pointer: Point, grab: Point, size: Size, strip: Rect, laneTop: number): Rect {
  const left = band(pointer.x - grab.x, strip.left, strip.right - size.width)
  const top = laneTop + pull(pointer.y, strip.top, strip.bottom)
  return { left, top, right: left + size.width, bottom: top + size.height }
}

/** A window's strip on screen, for the snap back. `key` names the window. */
export interface StripTarget<K = number> {
  key: K
  rect: Rect
}

/**
 * The strip the cursor is over, with the snap margin (spec 1.4): the first in
 * the list wins, so the caller lists them front-most first. Step 3 lists only
 * the source window's; step 4 lists every window's.
 */
export function stripUnder<K>(p: Point, targets: ReadonlyArray<StripTarget<K>>, margin: number = TEAR.snapMargin): StripTarget<K> | null {
  for (const t of targets) if (inside(p, grow(t.rect, margin))) return t
  return null
}

/** How long the cursor has been over one strip. */
export interface Dwell<K = number> {
  key: K
  since: number
}
/**
 * One tick of the snap-back dwell (spec 1.4): `fire` once the cursor has stayed
 * over the same strip for `ms`. Leaving resets it; a different strip starts it
 * again.
 */
export function dwellStep<K>(
  was: Dwell<K> | null,
  over: K | null,
  now: number,
  ms: number = TEAR.dwellMs
): { dwell: Dwell<K> | null; fire: boolean } {
  if (over === null) return { dwell: null, fire: false }
  const dwell = was && was.key === over ? was : { key: over, since: now }
  return { dwell, fire: now - dwell.since >= ms }
}

/**
 * The floating window's size (spec 1.8): the source's normal (restored) size,
 * never maximized; at least half the work area when the source was maximized;
 * never more than the work area less the inset on each side.
 */
export function floatSize(normal: Size, maximized: boolean, work: Bounds, inset: number = TEAR.inset): Size {
  const maxW = Math.max(1, work.width - inset * 2)
  const maxH = Math.max(1, work.height - inset * 2)
  const w = maximized ? Math.max(normal.width, work.width / 2) : normal.width
  const h = maximized ? Math.max(normal.height, work.height / 2) : normal.height
  return { width: Math.round(Math.min(w, maxW)), height: Math.round(Math.min(h, maxH)) }
}

/**
 * Where the window goes so the point it is held by (`grab`, in window
 * coordinates: its frame, then the tab's place in its strip, then the press
 * inside the tab) sits under the cursor. Its top never rises above the work
 * area (the title row stays reachable) and some of it always stays on the
 * display (`keepVisible`), so a window can never be lost off an edge.
 */
export function floatBounds(cursor: Point, grab: Point, size: Size, work: Bounds, keep: number = TEAR.keepVisible): Bounds {
  const x = clamp(Math.round(cursor.x - grab.x), work.x - size.width + keep, work.x + work.width - keep)
  const y = clamp(Math.round(cursor.y - grab.y), work.y, work.y + work.height - keep)
  return { x, y, width: size.width, height: size.height }
}

/** The tab the slot is asked for: the lane whose middle is right of `x`. */
export function slotAt(mids: readonly number[], x: number): number {
  const at = mids.findIndex((m) => x < m)
  return at === -1 ? mids.length : at
}

/**
 * EVERYTHING A TAB TAKES WITH IT (spec 1, "What a moved tab keeps"). The tab
 * itself is plain JSON; the rest lives in the page's own module stores (and
 * so does not cross windows by itself): the unsaved text it owns, its volume
 * and speed, where its file had got to and whether it was playing, a
 * document's place, the archive passwords given for it, and the listing on
 * screen so the new window's first frame has rows. In main, everything keyed
 * by the tab's id (grants, the folder watch, listings, the archive passwords
 * main holds) stays put: it is the same tab, not a reopened one.
 */
export interface TabCarry {
  tab: {
    id: string
    pinned?: boolean
    root: string
    browse: SavedBrowse
    files: ViewerFile[]
    index: number
  }
  buffers: Array<{ path: string; text: string }>
  level?: { vol: number; muted: boolean; rate: number }
  /** Per media key (the file's media URL): where it had got to, paused or not. */
  marks?: Array<{ key: string; t: number; paused: boolean }>
  /** Per document path: the place in it. */
  docPos?: Array<{ key: string; value: number }>
  passwords?: Array<{ path: string; password: string }>
  listing?: { path: string; listing: DirListing }
}

/** What a tear asks of main (`tabs:tear`). */
export interface TearRequest {
  tabId: string
  /** The window's only tab: the WHOLE window follows the cursor (spec 1.7). */
  only: boolean
  /** The tab and its state, for the new window. Absent for `only`. */
  carry?: TabCarry
  /** Where the press is inside the tab. */
  grab: Point
  /** Where a window's FIRST tab sits in its strip (client coordinates): the
   *  new window's one tab is there, so the cursor holds it at `origin + grab`.
   *  The new page reports its own once it has drawn the tab. */
  origin: Point
  /** The snap-back target, client coordinates: the source's strip held to
   *  the tear zone (`snapTarget`). */
  strip: Rect
  /** The cursor, client coordinates (the e2e's pointer; main polls the real one). */
  point: Point
}

/** How a tear ended, as the source page says it. */
export type TearEnd = 'drop' | 'cancel'

/** Main's word to the source page during a tear. */
export type TearEvent =
  | { kind: 'shown'; tabId: string }
  | { kind: 'attached'; tabId: string }
  | { kind: 'ended'; tabId: string }

/** A carry is plausible enough to relay: main reads only the id and the root. */
export function validCarry(c: unknown): c is TabCarry {
  const t = (c as TabCarry | null)?.tab
  return (
    !!t &&
    typeof t.id === 'string' &&
    !!t.id &&
    typeof t.root === 'string' &&
    !!t.browse &&
    Array.isArray(t.files) &&
    Array.isArray((c as TabCarry).buffers)
  )
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const validPoint = (p: unknown): p is Point => !!p && finite((p as Point).x) && finite((p as Point).y)
const validRect = (r: unknown): r is Rect =>
  !!r && finite((r as Rect).left) && finite((r as Rect).top) && finite((r as Rect).right) && finite((r as Rect).bottom)

/** The page's request, checked before main acts on it. */
export function validTearRequest(r: unknown): r is TearRequest {
  const q = r as TearRequest | null
  if (!q || typeof q.tabId !== 'string' || !q.tabId || typeof q.only !== 'boolean') return false
  if (!validPoint(q.grab) || !validPoint(q.origin) || !validPoint(q.point) || !validRect(q.strip)) return false
  return q.only || (validCarry(q.carry) && q.carry.tab.id === q.tabId)
}
