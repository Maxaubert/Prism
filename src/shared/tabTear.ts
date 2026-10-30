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
 * - Step 4 (attach into ANY window, owner 2026-10-29): every window reports
 *   its strip (`StripReport`); main asks `attachRects` where another window's
 *   strip takes a tab and where the tab tears out of it again, and brings a
 *   window to the front after `raiseMs` under the cursor.
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
  lateDropMs: 10000,
  /** Step 4: a window the carried tab stays over this long (anywhere on it) is
   *  brought to the front, without the focus, so a strip under another window
   *  can be reached. Chrome's tab drag waits 750 ms; Prism the same, so a pass
   *  across a window on the way somewhere else raises nothing. */
  raiseMs: 750,
  /** A carried tab's size when the page did not say. */
  tabWidth: 114,
  tabHeight: 32,
  /** THE GHOST (owner, 2026-10-30): its window is the tab itself, no room
   *  around it. A transparent window draws nothing here (Prism turns
   *  DirectComposition off), so the ghost is opaque and see-through by its
   *  window's opacity instead ("the tab still but just slightly lower
   *  opacity", owner, 2026-10-30). */
  ghostPad: 0,
  /** How see-through the carried tab is. */
  ghostOpacity: 0.85,
  /** A ghost's label is cut to this many characters. */
  ghostLabelMax: 200,
  /** The biggest tab a page may say it carries (review 2026-10-30): the
   *  ghost sits above every app, so a page must not make it screen-sized.
   *  The strip's widest tab is well inside this. */
  tabMaxWidth: 400,
  tabMaxHeight: 64,
  /** What shows at the drop (or a ghost lit up) waits at most this long for
   *  its page to draw a frame on screen. */
  drawnMs: 250
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
 * the list wins, so the caller lists them front-most first. Main (step 4)
 * walks the windows front to back itself, since a window's body also hides the
 * strips behind it; this stays the one-list question.
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
 * A window's strip as its page reports it (step 4), client coordinates: the
 * strip, and the right edge of its + button. Main keeps the last one per
 * window; a window with no strip (fullscreen, no tabs) reports null.
 */
export interface StripReport {
  strip: Rect
  plusRight: number
}

/**
 * ANOTHER WINDOW'S STRIP AS A TARGET (step 4, owner 2026-10-29): the same two
 * rects the source's own strip has. A carried tab ATTACHES once the cursor has
 * stayed over `snap` (plus the 8 DIP margin) for the dwell, and TEARS OUT again
 * once it is fully outside `zone` with the cursor 12 DIP out (the tear's own
 * hysteresis; the zone ends one carried-tab width past the +).
 */
export function attachRects(r: StripReport, tabWidth: number): { snap: Rect; zone: Rect } {
  const zone = tearZone(r.strip, r.plusRight, tabWidth)
  return { snap: snapTarget(r.strip, zone), zone }
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

/**
 * THE GHOST'S PLACE (owner, 2026-10-30: "let it just be the tab you're
 * carrying, that's how file explorer does it"): the tab-sized window that
 * follows the cursor while a torn tab is outside every strip, held at the same
 * grab point as in the strip (so it does not jump at the tear), with `pad`
 * round it for its shadow. Never held to the work area: it is the cursor's.
 */
export function ghostBounds(cursor: Point, grab: Point, size: Size, pad: number = TEAR.ghostPad): Bounds {
  const z = tabSize(size)
  return {
    x: Math.round(cursor.x - grab.x - pad),
    y: Math.round(cursor.y - grab.y - pad),
    width: Math.round(z.width + pad * 2),
    height: Math.round(z.height + pad * 2)
  }
}

/** The carried tab's size as main uses it: what the page said, held to a
 *  tab's size (review 2026-10-30: the ghost above every app must never be
 *  made screen-sized), or the default when it said nothing. */
export function tabSize(z: Size | undefined): Size {
  if (!z) return { width: TEAR.tabWidth, height: TEAR.tabHeight }
  return { width: clamp(z.width, 1, TEAR.tabMaxWidth), height: clamp(z.height, 1, TEAR.tabMaxHeight) }
}

/** Set bounds, and once more if they did not come out as asked: Electron
 *  converts DIP to pixels with the display the window is on NOW, so a jump
 *  to a display of another scale lands at the wrong size or place the first
 *  time (review 2026-10-30). */
export function setBoundsSure(w: { setBounds(b: Bounds): void; getBounds(): Bounds }, b: Bounds): void {
  w.setBounds(b)
  const got = w.getBounds()
  if (got.x !== b.x || got.y !== b.y || got.width !== b.width || got.height !== b.height) w.setBounds(b)
}

/**
 * How the carried tab looks, as the source page's theme draws it (the ghost
 * is a page of its own with none of the app's styles). Computed colours and
 * the tab's font family; main checks each (`validTabLook`) before the ghost
 * uses them, so nothing but a colour or a font name gets in.
 */
export interface TabLook {
  /** The strip's ground (--p-tabs), the tab's ink, its edge and accent rule. */
  ground: string
  ink: string
  edge: string
  accent: string
  font: string
}

const COLOUR = /^(?:#[0-9a-f]{3,8}|transparent|(?:rgba?|hsla?|color|lab|lch|oklab|oklch)\([0-9a-z.,%\s/+-]*\))$/i
const FONT = /^[\w\s,"'.-]+$/
/** A computed CSS colour (no `url(`, no second value). */
export const validColour = (c: unknown): c is string => typeof c === 'string' && c.length <= 80 && COLOUR.test(c)
export function validTabLook(l: unknown): l is TabLook {
  const q = l as TabLook | null
  return (
    !!q &&
    validColour(q.ground) &&
    validColour(q.ink) &&
    validColour(q.edge) &&
    validColour(q.accent) &&
    typeof q.font === 'string' &&
    q.font.length <= 200 &&
    FONT.test(q.font)
  )
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
  /** The tab and its state, for the new window. For `only` too since step 4:
   *  the only tab can merge into another window's strip. */
  carry?: TabCarry
  /** The carried tab's size (another window's strip judges the tear-out by
   *  it) and its label (that strip draws it while it hovers there). */
  size?: Size
  label?: string
  /** How it looks, for the ghost that follows the cursor (owner, 2026-10-30).
   *  One that fails `validTabLook` is dropped (the ghost's own colours), never
   *  the tear. */
  look?: TabLook
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

/** Main's word to the source page during a tear. `over`: the tab is in
 *  ANOTHER window's strip now (step 4), so no chip follows the pointer here;
 *  `off`: it tore out of that strip again. */
export type TearEvent =
  | { kind: 'shown'; tabId: string }
  | { kind: 'attached'; tabId: string }
  | { kind: 'ended'; tabId: string }
  | { kind: 'over'; tabId: string }
  | { kind: 'off'; tabId: string }

/**
 * Step 4: what a window's strip is told while a carried tab hovers over it
 * (client coordinates of THAT window). It opens a gap at the slot under the
 * cursor and draws the tab there; null ends the hover.
 */
export interface TabHover {
  tabId: string
  point: Point
  grab: Point
  size: Size
  label: string
}

/** Step 4: the drop into another window's strip, to that window's page. `at`
 *  is the slot its strip last reported (null: the end). */
export interface TabMerge {
  carry: TabCarry
  at: number | null
}

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

const validSize = (z: unknown): z is Size =>
  !!z && finite((z as Size).width) && finite((z as Size).height) && (z as Size).width > 0 && (z as Size).height > 0

/** The page's request, checked before main acts on it. */
export function validTearRequest(r: unknown): r is TearRequest {
  const q = r as TearRequest | null
  if (!q || typeof q.tabId !== 'string' || !q.tabId || typeof q.only !== 'boolean') return false
  if (!validPoint(q.grab) || !validPoint(q.origin) || !validPoint(q.point) || !validRect(q.strip)) return false
  if (q.size !== undefined && !validSize(q.size)) return false
  if (q.label !== undefined && typeof q.label !== 'string') return false
  // The only tab's carry is optional (without one its window moves and merges
  // nowhere); a carry that is sent must be the tab's own.
  if (q.carry !== undefined && !(validCarry(q.carry) && q.carry.tab.id === q.tabId)) return false
  return q.only || q.carry !== undefined
}

/** A page's strip report (step 4), checked: null is a window with no strip. */
export function validStripReport(r: unknown): r is StripReport {
  const q = r as StripReport | null
  return !!q && validRect(q.strip) && finite(q.plusRight)
}
