import {
  TEAR,
  attachRects,
  dwellStep,
  floatBounds,
  floatSize,
  ghostBounds,
  grow,
  inside,
  rectOf,
  setBoundsSure,
  shouldTear,
  tabSize,
  validTabLook,
  type Bounds,
  type Dwell,
  type Point,
  type Rect,
  type Size,
  type StripReport,
  type TabCarry,
  type TabHover,
  type TabLook,
  type TearEnd,
  type TearEvent,
  type TearRequest
} from '@shared/tabTear'

/**
 * TAB TEAR-OFF, MAIN'S HALF (steps 3 and 4, owner, 2026-10-29; spec
 * docs/superpowers/specs/2026-10-29-tab-tearoff-design.md section 1).
 *
 * The strip keeps the pointer (its capture holds while the button is down, even
 * with the cursor outside the window) and decides the TEAR; from that moment
 * main owns the carry. One IPC (`tabs:tear`), then:
 *
 * - ONLY THE TAB follows the cursor (owner, 2026-10-30: "i dont wanna be
 *   carrying a full window ... actually let it just be the tab you're
 *   carrying, that's how file explorer does it"): a tab-sized GHOST window
 *   (tabGhost.ts), held at the same grab point as in the strip, above every
 *   app and never focused, so the source keeps the pointer. Main moves it
 *   every 8 ms from the cursor (`screen.getCursorScreenPoint`), the size
 *   passed each time for a mixed-DPI move; never from the renderer's events
 *   over IPC.
 * - A tab of several: the warm spare (or a fresh window if there is none) is
 *   taken at the tear and stays HIDDEN, and EMPTY, all through the drag; where
 *   it would go is worked out every tick. The source keeps the tab in front
 *   and on screen until the drop commits (owner, 2026-10-30: "i want those
 *   switches to happen when you drop it"), so the spare is handed the tab
 *   only at the drop, packed THEN (`end`'s carry): a film still playing in
 *   the source, a playlist that moved on, are what the new window gets, and
 *   the hidden window never plays a second copy. It is placed so its tab
 *   sits under the cursor where the ghost was, and shown, once its page has
 *   drawn the tab (the ghost holds the drop point until then).
 * - The window's ONLY tab is carried the same way (owner, 2026-10-30: "when
 *   you then drag a tab from a single tab window you just drag the window it
 *   should be the tab you drag"; this replaces the 2026-10-29 choice that the
 *   whole window followed): the ghost follows, the window stays where it is.
 *   Dropped outside every strip, THAT window is moved (normal size, a
 *   maximized one restored) so its tab sits under the drop point, exactly
 *   where a new window would go, and brought to the front; no window is made.
 *   It is clear while it moves, and the ghost holds the drop point until it
 *   has drawn there. That window hides no strip behind it while its tab is
 *   carried (review 2026-10-30: a maximized one could merge nowhere on its
 *   own monitor): a strip under it takes the tab, and its window comes to
 *   the front at once so the tab it draws is seen.
 * - Over the source's own strip (its rect plus 8 DIP) for 120 ms, the tab
 *   attaches again: the ghost hides, and the strip carries on as a reorder.
 * - STEP 4, OVER ANY OTHER WINDOW'S STRIP (spec 1.4, 1.7) for the same 120 ms,
 *   the tab attaches THERE, live: the ghost hides, and that strip opens a gap
 *   at the slot under the cursor and draws the tab in it (`hover`, every tick
 *   the cursor moves). Fully out of that strip again (the tear's own rule and
 *   hysteresis, `attachRects`), it tears off again: the ghost is back under
 *   the cursor. Released there, the tab is MERGED into that window at its
 *   slot, selected, that window in front; the only tab's emptied window
 *   closes. Its state moves exactly as in a tear: the same id, what it
 *   carried (packed at the drop), `handTab` at the commit, nothing released.
 * - Windows are hit-tested FRONT TO BACK, as the system stacks them (asked
 *   again every tick; without the native addon, the one focused or raised
 *   most recently in front, ties the newest), and a window's body hides the
 *   strips behind it. ANOTHER APP'S window hides them too (`covered`, review
 *   2026-10-30): a strip under a browser takes nothing, and a tab in a strip
 *   tears out of it where something in front of that window is under the
 *   cursor. A window the cursor stays over for 750 ms (`TEAR.raiseMs`,
 *   Chrome's number) is brought to the front without the focus (the source
 *   keeps the pointer), so a strip under another window can be reached; a
 *   tab that then goes back to its source, or a cancel, brings the source
 *   (still focused) to the front again.
 * - The page's pointer-up ends it: a drop makes the floating window a window of
 *   the session (placed, shown, focused, the ghost gone) and only THEN does
 *   the source let the tab go; a cancel (Escape, right-click, lost capture,
 *   blur, a window closing) hides the ghost and closes any gap it had opened
 *   in another strip. Nothing else changed during the drag, so nothing needs
 *   putting back. Nothing half-done is ever committed: a drop waits for the
 *   floating page to draw the tab, and a page that never comes (10 s) gives
 *   the tab back.
 *
 * In memory only: no disk, no process (syncCalls.test.ts, spawnCalls.test.ts).
 * Pure apart from what `TearDeps` hands it, so `tearOff.test.ts` drives it with
 * fake windows and fake time.
 *
 * Under --e2e no window is ever moved: the windows stay parked offscreen and
 * the cursor is the page's pointer (`point`), since Playwright's mouse is not
 * the system cursor, read as if the window sat at the top-left of the display
 * (`clientToScreen`). Where a window WOULD go is kept for the e2e (`state`).
 * Every parked window would sit at that same place, so under --e2e a window
 * other than the source is a target only once the e2e has said where it
 * pretends to be (`e2eAt`, an offset from that top-left).
 */

/** What the tear needs of a BrowserWindow. */
export interface TearWin {
  isDestroyed(): boolean
  getBounds(): Bounds
  getContentBounds(): Bounds
  getNormalBounds(): Bounds
  setBounds(b: Bounds): void
  isMaximized(): boolean
  unmaximize(): void
  showInactive(): void
}

export interface TearDeps<W extends TearWin> {
  e2e: boolean
  /** The cursor on screen, in DIP. */
  cursor(): Point
  /** The work area of the display nearest a point. */
  workArea(p: Point): Bounds
  /** The spare, made now if there is none (hidden; its page may still be loading). */
  takeSpare(): W
  /** Its page is listening: a tab handed over now is heard. */
  listening(win: W): boolean
  /** Hand the tab to the floating window's page. */
  adopt(win: W, carry: TabCarry): void
  /** The tab is in two pages (or its window is closing): its main-side state
   *  stays whoever closes. */
  moving(tabId: string, on: boolean): void
  /** The drop: the floating window becomes a window of the session, and the
   *  tab is no longer `source`'s. */
  commit(win: W, carry: TabCarry, source: W): void
  /** Show a committed window and bring it to the front, focused (under
   *  --e2e only shown). */
  reveal(win: W): void
  /** The floating window gives the tab back and hides as the spare. `to` is
   *  who has the tab now: the source, or null when the source has closed
   *  (nobody has it). Only once it was handed the tab (a drop that failed). */
  release(win: W, tabId: string, to: W | null): void
  /** A word to the source page. */
  tell(source: W, event: TearEvent): void
  /** Make the next spare a moment from now. */
  spareSoon(): void
  /* ----- step 4: attach into any window (all optional: without them only the
   * source's own strip is a target, as in step 3) ----- */
  /** The session's windows that can take a tab (shown, restored, not
   *  minimized, not the spare), front to back as the system stacks them, else
   *  the one focused or raised most recently first, ties newest first. Asked
   *  every tick: the order and the windows change under a drag. */
  windowsFront?(): W[]
  /** A window of another app, in front of `win`, is under that screen point
   *  (it hides `win` there). Never under --e2e. */
  covered?(p: Point, win: W): boolean
  /** The strip a window's page reported last, or null (none on screen). */
  stripOf?(win: W): StripReport | null
  /** A window's name, for the e2e and the log. */
  name?(win: W): string
  /** Tell a window's strip where the carried tab hovers over it (null: no more). */
  hover?(win: W, hover: TabHover | null): void
  /** The drop into another window's strip: `target` has the tab from now on,
   *  at its strip's slot `at`, and `source` no longer does. */
  merge?(target: W, carry: TabCarry, source: W, at: number | null): void
  /** To the front without the focus (never under --e2e). */
  raise?(win: W): void
  /** It came to the front without the focus, for the order `windowsFront`
   *  answers when the system's cannot be read (under --e2e too). */
  raised?(win: W): void
  /** THE GHOST (owner, 2026-10-30): the tab-sized window that follows the
   *  cursor while the tab is outside every strip. `shown` once it is on
   *  screen (the source's own chip can go then). Without one the source's
   *  chip follows the pointer inside its window. */
  ghost?: {
    show(face: { label: string; size: Size; look?: TabLook }, at: Bounds, shown: () => void): void
    move(at: Bounds): void
    hide(): void
  }
  /** `fn` once `win`, just shown, has drawn a frame on screen (or failed to):
   *  the ghost stays up until then at a drop, so there is never a frame with
   *  neither it nor the tab (review 2026-10-30). Without it the ghost goes at
   *  once. */
  drawn?(win: W, fn: () => void): void
  /** A window clear (`out`) or back: the only tab's window while a drop
   *  restores and moves it (never called under --e2e). */
  fade?(win: W, out: boolean): void
  /** The only tab merged away: its emptied window closes, asking nothing. */
  closeEmptied?(win: W): void
  log?(event: string, fields: Record<string, string | number | boolean>): void
  now?(): number
  every?(fn: () => void, ms: number): unknown
  stop?(handle: unknown): void
  /** One-shot timer (the drop's wait). */
  after?(fn: () => void, ms: number): unknown
  cancel?(handle: unknown): void
}

/** A drop outside every strip: the floating page is handed the tab now, and
 *  nothing is committed until it has drawn it. */
interface Late<W> {
  tabId: string
  source: W
  win: W
  carry: TabCarry
  sent: boolean
  /** The cursor at the drop, the press inside the tab, and where the
   *  floating page's tab sits (its own once it has said). */
  at: Point
  grab: Point
  origin: Point
  size: Size
  /** The ghost's turn while it waits at the drop point (null: it was not
   *  up): it goes when the wait ends, unless a later tear has it since. */
  ghost: number | null
  timer: unknown
  resolve(answer: { committed: boolean }): void
}

/** The tab is in ANOTHER window's strip (step 4). */
interface Over<W> {
  win: W
  /** The slot that strip reported last (null: none yet, the end). */
  slot: number | null
  /** The last hover sent, so an unmoved cursor sends nothing. */
  sent: string | null
}

interface Common<W> {
  tabId: string
  source: W
  /** What it carries (for the only tab, null if the page sent none: it then
   *  moves its window and merges nowhere). Replaced by the drop's own. */
  carry: TabCarry | null
  /** The press inside the tab, and where the window's first tab sits. */
  grab: Point
  origin: Point
  /** The size of the window the tab goes to (or, the only tab, its own). */
  size: { width: number; height: number }
  /** The carried tab's own size, label and look. */
  tab: Size
  label: string
  look: TabLook | undefined
  /** The source's strip, client coordinates (held to the tear zone). */
  strip: Rect
  /** Which strip the cursor has stayed over, and since when. */
  dwell: Dwell<W> | null
  /** In another window's strip now. */
  over: Over<W> | null
  /** The windows front to back, as of this tick. */
  z: W[]
  /** Which window the cursor has stayed over, for the raise. */
  rdwell: Dwell<W> | null
  /** A window was raised above the source: a tab going back to it brings it
   *  to the front again. */
  lifted: boolean
  /** The ghost: off (in a strip, or ended), asked for, or on screen. */
  ghost: 'off' | 'asked' | 'up'
  /** Where the ghost is (or, under --e2e, would be). */
  gb: Bounds | null
  point: Point
  /** Where the window would go at a drop outside every strip. */
  last: Bounds | null
}
interface Floating<W> extends Common<W> {
  kind: 'float'
  win: W
  carry: TabCarry
}
/** The window's only tab: its window stays put until the drop. */
interface OnlyTab<W> extends Common<W> {
  kind: 'window'
}
type Session<W> = Floating<W> | OnlyTab<W>

/** What the e2e reads (`__e2eTear`). */
export interface TearState {
  phase: 'idle' | 'float' | 'window'
  tabId: string | null
  /** Where the window WOULD go at a drop outside every strip: the hidden
   *  floating one for a tab of several, the source for its only tab. */
  bounds: Bounds | null
  /** What follows the cursor is on screen: the ghost. */
  shown: boolean
  /** Where the ghost is (or would be) while it is asked for; null otherwise. */
  ghost: Bounds | null
  /** A drop is waiting for the floating page to draw the tab. */
  waiting: boolean
  /** The window whose strip the tab is in now (step 4), by name. */
  over: string | null
  /** The slot that strip has open for it. */
  slot: number | null
  /** The window in front, as the tear sees it. */
  front: string | null
  /** Where the last only-tab drop outside every strip moved its window (or,
   *  under --e2e, would have). */
  moved: Bounds | null
  /** Tears and their ends since the start, for the e2e's counts. */
  tears: number
  commits: number
  attaches: number
  cancels: number
  /** Step 4: into another strip, out of it again, dropped there, raised. */
  enters: number
  leaves: number
  merges: number
  raises: number
  /** Only-tab windows moved by a drop outside every strip. */
  moves: number
}

export interface TearOff<W extends TearWin> {
  start(source: W, req: TearRequest): boolean
  /** The page's pointer, client coordinates (--e2e only). */
  point(source: W, client: Point): void
  /** A spare's page has started listening. */
  listening(win: W): void
  /** The floating page has drawn the tab; `tab` is where (client coordinates). */
  adopted(win: W, tab: Point | null): void
  /** The page's pointer-up (or its cancel). A drop brings the tab as it is
   *  NOW (`carry`, packed at the drop); one outside every strip answers once
   *  the floating page has drawn it (or has failed to): only then is anything
   *  committed. */
  end(source: W, how: TearEnd, carry?: TabCarry): Promise<{ committed: boolean }>
  /** A window has closed or crashed. Called BEFORE it leaves the registry, so
   *  a tab that was flying is not moving any more when its close releases. */
  gone(win: W): void
  /** A window's page went away (a reload) while its window stays: as the
   *  source it can no longer end the tear, so main does; as the strip the tab
   *  hovers in, the tab tears out of it. */
  lost(win: W): void
  /** The spare in use, if any: it must not be destroyed or reused under the tear. */
  busy(win: W): boolean
  /** A strip's page says which slot it has open for the hovering tab. */
  slot(win: W, tabId: string, at: number): void
  /** Under --e2e only: where a parked window pretends to be (an offset from
   *  the work area's top-left), so it can be a target; null forgets it. */
  e2eAt(win: W, at: Point | null): void
  state(): TearState
}

const same = (a: Bounds | null, b: Bounds): boolean =>
  !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
const shift = (r: Rect, by: Point): Rect => ({ left: r.left + by.x, top: r.top + by.y, right: r.right + by.x, bottom: r.bottom + by.y })

/** The carried tab's label when the page did not say: its folder's name. */
const labelOf = (carry: TabCarry | null): string => {
  const p = carry?.tab.browse.path ?? carry?.tab.root ?? ''
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

export function createTearOff<W extends TearWin>(deps: TearDeps<W>): TearOff<W> {
  const now = deps.now ?? (() => Date.now())
  const every = deps.every ?? ((fn: () => void, ms: number) => setInterval(fn, ms))
  const stopTimer = deps.stop ?? ((h: unknown) => clearInterval(h as NodeJS.Timeout))
  const after = deps.after ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const cancelTimer = deps.cancel ?? ((h: unknown) => clearTimeout(h as NodeJS.Timeout))
  const nameOf = (w: W | null | undefined): string | null => (w ? (deps.name?.(w) ?? '') : null)
  let session: Session<W> | null = null
  let loop: unknown = null
  /** A drop outside every strip, waiting for the floating page to draw the
   *  tab: committed, shown and answered once it has. */
  let late: Late<W> | null = null
  /** Where the last only-tab drop moved its window (`state().moved`). */
  let moved: Bounds | null = null
  /** Windows that have closed. Electron's 'closed' comes before the window is
   *  destroyed, so `isDestroyed` alone would still call it alive there. */
  const dead = new WeakSet<W>()
  const alive = (w: W): boolean => !dead.has(w) && !w.isDestroyed()
  /** Emptied by a merge and closing: the tab they held stays marked moving
   *  until the registry has forgotten them, so their close releases nothing. */
  const emptied = new Map<W, string>()
  /** Under --e2e: where each parked window pretends to be. */
  const placed = new WeakMap<W, Point>()
  const counts = { tears: 0, commits: 0, attaches: 0, cancels: 0, enters: 0, leaves: 0, merges: 0, raises: 0, moves: 0 }

  const frame = (w: W): Point => {
    const b = w.getBounds()
    const c = w.getContentBounds()
    return { x: c.x - b.x, y: c.y - b.y }
  }
  /** The point a window is held by, in window coordinates: its frame, its
   *  first tab's place in its strip, the press inside the tab. */
  const holdAt = (w: W, origin: Point, grab: Point): Point => {
    const f = frame(w)
    return { x: f.x + origin.x + grab.x, y: f.y + origin.y + grab.y }
  }
  /** The cursor: the system's, or under --e2e the page's pointer. */
  const cursorOf = (s: Session<W>): Point => (deps.e2e ? s.point : deps.cursor())
  /** Where a window's outer top-left is on screen. Under --e2e the windows
   *  are parked off every display (-4000), where every place a window would
   *  go is held to the same display edge (`keepVisible`), so the e2e could
   *  never see it follow: a window is read as if it sat at the top-left of the
   *  nearest work area instead, moved by what the e2e said (`e2eAt`). */
  const originOf = (w: W): Point => {
    const b = w.getBounds()
    if (!deps.e2e) return { x: b.x, y: b.y }
    const a = deps.workArea({ x: b.x, y: b.y })
    const off = placed.get(w) ?? { x: 0, y: 0 }
    return { x: a.x + off.x, y: a.y + off.y }
  }
  /** A page's client point on screen. */
  const clientToScreen = (w: W, p: Point): Point => {
    const o = originOf(w)
    const f = frame(w)
    return { x: o.x + f.x + p.x, y: o.y + f.y + p.y }
  }
  const screenToClient = (w: W, p: Point): Point => {
    const o = clientToScreen(w, { x: 0, y: 0 })
    return { x: p.x - o.x, y: p.y - o.y }
  }
  /** A window's whole rect on screen (what hides the strips behind it). */
  const screenRect = (w: W): Rect => {
    const o = originOf(w)
    const b = w.getBounds()
    return rectOf({ x: o.x, y: o.y, width: b.width, height: b.height })
  }
  const stopLoop = (): void => {
    if (loop !== null) stopTimer(loop)
    loop = null
  }
  /** The window the tab would be in at a drop outside every strip. */
  const homeOf = (s: Session<W>): W => (s.kind === 'float' ? s.win : s.source)
  /** Where that window would go so its tab sits under the cursor. Worked
   *  out, never applied, during the drag: nothing moves but the ghost. */
  const place = (s: Session<W>): void => {
    const p = cursorOf(s)
    const b = floatBounds(p, holdAt(homeOf(s), s.origin, s.grab), s.size, deps.workArea(p))
    if (!same(s.last, b)) s.last = b
  }

  /* ----- THE GHOST (owner, 2026-10-30): only the tab follows the cursor ----- */
  /** Bumped each time a tear shows or hides the ghost: a hide that waits (for
   *  a window to draw, for a drop's wait) goes only if nothing has had the
   *  ghost since. */
  let ghostTurn = 0
  /** `fn` once `win` has drawn a frame on screen (at most `TEAR.drawnMs`
   *  from now), or at once without a way to tell. */
  const whenDrawn = (win: W, fn: () => void): void => {
    if (!deps.drawn) return fn()
    let done = false
    let timer: unknown = null
    const go = (): void => {
      if (done) return
      done = true
      if (timer !== null) cancelTimer(timer)
      fn()
    }
    timer = after(go, TEAR.drawnMs)
    deps.drawn(win, go)
  }
  /** The ghost goes: at once, or, given the window just shown at a drop, once
   *  that window has drawn a frame on screen (at most `TEAR.drawnMs`). */
  const ghostGo = (drawnBy: W | null): void => {
    const turn = ++ghostTurn
    if (!deps.ghost) return
    if (!drawnBy || !deps.drawn) return deps.ghost.hide()
    whenDrawn(drawnBy, () => {
      if (turn === ghostTurn) deps.ghost?.hide()
    })
  }
  const ghostAt = (s: Session<W>): Bounds => ghostBounds(cursorOf(s), s.grab, s.tab)
  /** Out of every strip: the ghost shows under the cursor. */
  const showGhost = (s: Session<W>): void => {
    if (s.ghost !== 'off' || s.over) return
    s.ghost = 'asked'
    s.gb = ghostAt(s)
    ghostTurn += 1
    if (!deps.ghost) return
    deps.ghost.show({ label: s.label, size: s.tab, look: s.look }, s.gb, () => {
      if (session !== s || s.ghost !== 'asked') return
      s.ghost = 'up'
      deps.tell(s.source, { kind: 'shown', tabId: s.tabId })
    })
  }
  /** In a strip, or ended: the ghost goes at once. */
  const hideGhost = (s: Session<W>): void => {
    if (s.ghost === 'off') return
    s.ghost = 'off'
    s.gb = null
    ghostGo(null)
  }
  const moveGhost = (s: Session<W>): void => {
    if (s.ghost === 'off') return
    const b = ghostAt(s)
    if (same(s.gb, b)) return
    s.gb = b
    deps.ghost?.move(b)
  }

  /** The windows the cursor can be over, front to back: never the hidden
   *  floating one. Under --e2e a window other than the source counts only
   *  once it is placed. */
  const candidates = (s: Session<W>): W[] =>
    s.z.filter(
      (w) => alive(w) && !(s.kind === 'float' && w === s.win) && (!deps.e2e || w === s.source || placed.has(w))
    )
  /** The strip a window takes the tab by, on screen: the source's own as its
   *  page sent it with the tear (held to the tear zone, `snapTarget`), any
   *  other's as its page reported it. */
  const snapOf = (s: Session<W>, w: W): Rect | null => {
    if (w === s.source) return shift(s.strip, clientToScreen(w, { x: 0, y: 0 }))
    // Nothing to merge with: the only tab whose page sent no carry.
    if (!s.carry) return null
    const r = deps.stripOf?.(w)
    return r ? shift(attachRects(r, s.tab.width).snap, clientToScreen(w, { x: 0, y: 0 })) : null
  }
  /** Another app's window in front of `w` is under the point. */
  const covered = (p: Point, w: W): boolean => !deps.e2e && !!deps.covered?.(p, w)
  /** The windows front to back, as of now: the system's order (a raise is in
   *  it), and only those that can still take a tab (a page reloading, a
   *  window minimized under the drag are not). The source always counts. */
  const refresh = (s: Session<W>): void => {
    if (!deps.windowsFront) return
    const z = [...deps.windowsFront()]
    if (!z.includes(s.source)) z.unshift(s.source)
    s.z = z
  }
  /** The only tab's own window: it stays where it is under the drag, but
   *  the eye is on the ghost, so its body hides no strip behind it and is
   *  never the window under the cursor (review 2026-10-30: focused, it was in
   *  front of every other, and a maximized one could merge into nothing on
   *  its monitor). Its own strip still takes the tab back. */
  const clear = (s: Session<W>, w: W): boolean => s.kind === 'window' && w === s.source
  /** The window whose strip is under the cursor, front to back: a window's
   *  body hides every strip behind it, and so does another app's window. */
  const stripHit = (s: Session<W>, p: Point): W | null => {
    for (const w of candidates(s)) {
      const snap = snapOf(s, w)
      if (snap && inside(p, grow(snap, TEAR.snapMargin)) && !covered(p, w)) return w
      if (!clear(s, w) && inside(p, screenRect(w))) return null
    }
    return null
  }
  /** The window the cursor is over, front-most; none where another app's
   *  window is in front of it. */
  const windowHit = (s: Session<W>, p: Point): W | null => {
    const w = candidates(s).find((x) => !clear(s, x) && inside(p, screenRect(x))) ?? null
    return w && !covered(p, w) ? w : null
  }
  /** Something in front of `w` is under the point: one of the session's
   *  windows, or another app's. */
  const hidden = (s: Session<W>, w: W, p: Point): boolean => {
    for (const x of candidates(s)) {
      if (x === w) break
      if (!clear(s, x) && inside(p, screenRect(x))) return true
    }
    return covered(p, w)
  }
  /** Bring a window to the front without the focus (only the bookkeeping
   *  under --e2e, where nothing is on screen). */
  const lift = (w: W): void => {
    if (!deps.e2e) deps.raise?.(w)
    deps.raised?.(w)
  }

  /** To the front without the focus, and in front for the hit test too. */
  const raiseNow = (s: Session<W>, w: W): void => {
    s.rdwell = null
    s.z = [w, ...s.z.filter((x) => x !== w)]
    counts.raises += 1
    lift(w)
    if (w !== s.source) s.lifted = true
    deps.log?.('tear-raise', { tab: s.tabId, win: nameOf(w) ?? '' })
  }
  /** THE RAISE (step 4): a window the cursor stays over for 750 ms comes to
   *  the front. The ghost stays above it: it is above every app. */
  const raiseStep = (s: Session<W>, p: Point): void => {
    const under = s.over ? s.over.win : windowHit(s, p)
    // In front already. (Under the only tab's own window it is not: that one
    // hides it on screen, if not from the hit test.)
    if (!under || candidates(s)[0] === under) {
      s.rdwell = null
      return
    }
    const step = dwellStep(s.rdwell, under, now(), TEAR.raiseMs)
    s.rdwell = step.dwell
    if (step.fire) raiseNow(s, under)
  }

  const sendHover = (s: Session<W>, o: Over<W>, client: Point): void => {
    const key = `${client.x},${client.y}`
    if (o.sent === key) return
    o.sent = key
    deps.hover?.(o.win, { tabId: s.tabId, point: client, grab: s.grab, size: s.tab, label: s.label })
  }
  /** Into another window's strip (step 4): the ghost goes, and that strip
   *  opens a gap for the tab and draws it. */
  const enter = (s: Session<W>, w: W): void => {
    const o: Over<W> = { win: w, slot: null, sent: null }
    s.over = o
    s.dwell = null
    counts.enters += 1
    // The only tab's own window lies over that strip here: the strip's window
    // comes to the front at once, so the tab it draws is on screen when the
    // ghost goes.
    const z = candidates(s)
    if (s.kind === 'window' && z.indexOf(s.source) < z.indexOf(w) && inside(cursorOf(s), screenRect(s.source))) {
      raiseNow(s, w)
    }
    hideGhost(s)
    deps.tell(s.source, { kind: 'over', tabId: s.tabId })
    sendHover(s, o, screenToClient(w, cursorOf(s)))
    deps.log?.('tear-over', { tab: s.tabId, win: nameOf(w) ?? '' })
  }
  /** Out of that strip again: its gap closes, and the ghost comes back under
   *  the cursor. */
  const leave = (s: Session<W>): void => {
    const o = s.over
    if (!o) return
    s.over = null
    s.dwell = null
    counts.leaves += 1
    if (alive(o.win)) deps.hover?.(o.win, null)
    deps.tell(s.source, { kind: 'off', tabId: s.tabId })
    showGhost(s)
    deps.log?.('tear-off-again', { tab: s.tabId, win: nameOf(o.win) ?? '' })
  }
  /** In another window's strip: it slides along it, and tears out again
   *  fully outside its zone (the same rule and hysteresis as the tear), or
   *  where something in front of that window is under the cursor (its strip
   *  does not show there: review 2026-10-30). */
  const hoverStep = (s: Session<W>, o: Over<W>, p: Point): void => {
    const r = alive(o.win) && s.z.includes(o.win) ? deps.stripOf?.(o.win) : null
    if (!r) return leave(s)
    const client = screenToClient(o.win, p)
    if (shouldTear(client, s.grab, s.tab, attachRects(r, s.tab.width).zone)) return leave(s)
    if (hidden(s, o.win, p)) return leave(s)
    sendHover(s, o, client)
  }

  const tick = (): void => {
    const s = session
    if (!s) return stopLoop()
    if (!alive(s.source)) return void finish('cancel', false)
    if (s.kind === 'float' && !alive(s.win)) return void finish('cancel', false)
    place(s)
    moveGhost(s)
    const p = cursorOf(s)
    refresh(s)
    if (s.over) hoverStep(s, s.over, p)
    raiseStep(s, p)
    if (s.over) return
    // THE SNAP BACK (spec 1.4): over a strip, with its margin, for 120 ms.
    // The source's own (held to the tear zone by the page, `snapTarget`)
    // gives the tab back to it; any other window's takes it (step 4).
    const hit = stripHit(s, p)
    const step = dwellStep(s.dwell, hit, now())
    s.dwell = step.dwell
    if (!step.fire || !hit) return
    if (hit === s.source) attach(s)
    else enter(s, hit)
  }
  /** The tab is the source's again after a window was raised above it: the
   *  source, which still has the focus, comes back to the front. */
  const unbury = (s: Session<W>): void => {
    if (s.lifted && alive(s.source)) lift(s.source)
  }
  /** Back over its own strip: main's part is over, the strip's reorder goes
   *  on. Nothing was handed anywhere, so nothing comes back. */
  const attach = (s: Session<W>): void => {
    stopLoop()
    session = null
    counts.attaches += 1
    hideGhost(s)
    unbury(s)
    deps.tell(s.source, { kind: 'attached', tabId: s.tabId })
    deps.log?.('tear-attach', { tab: s.tabId })
  }
  /** The drop is committed: the floating window is a window of the session. */
  const commit = (tabId: string, win: W, carry: TabCarry, source: W): void => {
    counts.commits += 1
    deps.commit(win, carry, source)
    deps.moving(tabId, false)
    deps.spareSoon()
    deps.log?.('tear-end', { tab: tabId, how: 'drop' })
  }
  /** A drop that does not commit: the floating window gives the tab back if
   *  it was handed it, and hides as the spare; the source has it still. */
  const giveBack = (l: Late<W>): void => {
    counts.cancels += 1
    // Even when the source has gone: the floating window is the spare again,
    // and main releases the tab with the source's close (`gone` first).
    if (l.sent && alive(l.win)) deps.release(l.win, l.tabId, alive(l.source) ? l.source : null)
    deps.moving(l.tabId, false)
    deps.log?.('tear-end', { tab: l.tabId, how: 'cancel' })
  }
  /** The drop's wait is over: the page drew the tab (`ok`), or the window
   *  failed to load in time, or one of the two windows went. */
  const settleLate = (ok: boolean): void => {
    const l = late
    if (!l) return
    late = null
    cancelTimer(l.timer)
    // The ghost waited at the drop point (review 2026-10-30: nothing was on
    // screen until the page was ready); it goes now, unless a later tear has
    // it since.
    const ghost = l.ghost !== null && l.ghost === ghostTurn
    if (ok && alive(l.win) && alive(l.source)) {
      commit(l.tabId, l.win, l.carry, l.source)
      // Placed so its tab (where its page drew it) sits under the drop point,
      // BEFORE it shows (again if a jump to a display of another scale got
      // it wrong); then in front, and the ghost goes only once it has drawn
      // (a window hidden all through the drag has drawn nothing yet: no frame
      // with neither, review 2026-10-30).
      const b = floatBounds(l.at, holdAt(l.win, l.origin, l.grab), l.size, deps.workArea(l.at))
      if (!deps.e2e) setBoundsSure(l.win, b)
      l.win.showInactive()
      deps.reveal(l.win)
      if (ghost) ghostGo(l.win)
      l.resolve({ committed: true })
      return
    }
    // "The new window failing to load commits nothing" (spec): the source
    // still has the tab, with everything it carried.
    if (ghost) ghostGo(null)
    giveBack(l)
    l.resolve({ committed: false })
  }
  /** THE DROP INTO ANOTHER WINDOW'S STRIP (step 4): that window has the tab,
   *  at the slot its strip had open, selected and in front. The floating
   *  window was never handed it: it is the spare still. The only tab's
   *  emptied window closes. */
  const merge = (s: Session<W>, o: Over<W>, carry: TabCarry): void => {
    counts.merges += 1
    if (s.kind === 'window') {
      // Its window closes next: the tab stays marked moving until the
      // registry has forgotten that window, so the close releases nothing.
      emptied.set(s.source, s.tabId)
      deps.moving(s.tabId, true)
    }
    deps.merge?.(o.win, carry, s.source, o.slot)
    if (s.kind === 'window') deps.closeEmptied?.(s.source)
    deps.reveal(o.win)
    deps.log?.('tear-end', { tab: s.tabId, how: 'merge', into: nameOf(o.win) ?? '', at: o.slot ?? -1 })
  }
  /** THE ONLY TAB DROPPED OUTSIDE EVERY STRIP (owner, 2026-10-30): its own
   *  window goes where a new window would, its tab under the drop point, at
   *  its normal size (a maximized one restored first), and to the front.
   *  It is clear while it is restored and moved, and the ghost holds the tab
   *  at the drop point until the window has drawn there (review 2026-10-30:
   *  the ghost went first, and a maximized window played its restore to its
   *  old place before it jumped). `ghostUp`: the ghost was asked for. */
  const moveWindow = (s: OnlyTab<W>, ghostUp: boolean): void => {
    const w = s.source
    const fade = !deps.e2e && !!deps.fade
    if (fade) deps.fade?.(w, true)
    if (w.isMaximized()) w.unmaximize()
    // Held by its frame as it is now, restored.
    s.last = null
    place(s)
    const b = s.last as Bounds | null
    counts.moves += 1
    moved = b
    if (b && !deps.e2e) setBoundsSure(w, b)
    deps.reveal(w)
    const turn = ghostUp ? ++ghostTurn : null
    whenDrawn(w, () => {
      if (fade && alive(w)) deps.fade?.(w, false)
      if (turn !== null && turn === ghostTurn) deps.ghost?.hide()
    })
    deps.log?.('tear-end', { tab: s.tabId, how: 'move', only: true })
  }
  /** End the session; answers whether a drop committed (the tab left the
   *  source). `fromPage`: the source page ended it (its pointer-up, its
   *  cancel); otherwise main did, and the page is told so it puts the tab
   *  back in its strip. */
  const finish = (how: TearEnd, fromPage: boolean): boolean => {
    const s = session
    if (!s) return false
    stopLoop()
    session = null
    const o = s.over
    if (o && how === 'drop' && s.carry && alive(o.win) && alive(s.source)) {
      hideGhost(s)
      merge(s, o, s.carry)
      return true
    }
    // Any gap it had opened in another strip closes.
    if (o && alive(o.win)) deps.hover?.(o.win, null)
    if (s.kind === 'window' && how === 'drop' && !o && alive(s.source)) {
      // The ghost goes once the moved window has drawn (`moveWindow`).
      const up = s.ghost !== 'off'
      s.ghost = 'off'
      s.gb = null
      moveWindow(s, up)
      return false
    }
    hideGhost(s)
    // Nothing was handed anywhere and nothing moved: the source has the tab,
    // in front if it was, exactly as before the drag.
    counts.cancels += 1
    unbury(s)
    if (!fromPage && alive(s.source)) deps.tell(s.source, { kind: 'ended', tabId: s.tabId })
    deps.log?.('tear-end', { tab: s.tabId, how: 'cancel', only: s.kind === 'window' })
    return false
  }
  /** A window or its page has gone: whatever it was part of ends. */
  const drop = (win: W, asFloating: boolean): void => {
    if (late && (late.source === win || (asFloating && late.win === win))) settleLate(false)
    const s = session
    if (!s) return
    // The strip it hovered in went: it tears out of it, and flies on.
    if (s.over?.win === win && s.source !== win) leave(s)
    if (s.source === win || (asFloating && s.kind === 'float' && s.win === win)) finish('cancel', false)
  }

  return {
    start(source, req) {
      if (!alive(source)) return false
      if (session) finish('cancel', false)
      counts.tears += 1
      const point = clientToScreen(source, req.point)
      const p = deps.e2e ? point : deps.cursor()
      const z = [...(deps.windowsFront?.() ?? [])]
      if (!z.includes(source)) z.unshift(source)
      const common = {
        tabId: req.tabId,
        source,
        grab: req.grab,
        origin: req.origin,
        // Held to a tab's size: the ghost above every app follows it.
        tab: tabSize(req.size),
        label: req.label ?? labelOf(req.carry ?? null),
        look: validTabLook(req.look) ? req.look : undefined,
        strip: req.strip,
        dwell: null,
        over: null,
        z,
        rdwell: null,
        lifted: false,
        ghost: 'off' as const,
        gb: null,
        point,
        last: null
      }
      let s: Session<W>
      if (req.only) {
        // Its window stays where it is (maximized too) until a drop outside
        // every strip moves it, at its normal size.
        s = {
          ...common,
          kind: 'window',
          carry: req.carry ?? null,
          size: floatSize(source.getNormalBounds(), false, deps.workArea(p))
        }
      } else {
        const carry = req.carry
        if (!carry) return false
        // Taken now, hidden and empty: a fresh one has the drag to load in.
        const win = deps.takeSpare()
        s = {
          ...common,
          kind: 'float',
          win,
          carry,
          size: floatSize(source.getNormalBounds(), source.isMaximized(), deps.workArea(p))
        }
      }
      session = s
      place(s)
      // Only the tab follows the cursor, from this moment.
      showGhost(s)
      deps.log?.('tear-start', { tab: req.tabId, only: req.only })
      loop = every(tick, TEAR.tickMs)
      return true
    },
    point(source, client) {
      if (session && session.source === source) session.point = clientToScreen(source, client)
    },
    listening(win) {
      if (late && late.win === win && !late.sent) {
        late.sent = true
        deps.adopt(win, late.carry)
      }
    },
    adopted(win, tab) {
      if (!late || late.win !== win) return
      // Its own strip, as drawn: the drop point holds THAT tab.
      if (tab) late.origin = tab
      settleLate(true)
    },
    end(source, how, carry) {
      const s = session
      if (!s || s.source !== source) return Promise.resolve({ committed: false })
      // The tab as it is NOW: the source kept it on screen all through the
      // drag (a film went on playing), so what the drop takes is packed at
      // the drop. Only the tab's own, and only where it could merge at all.
      if (how === 'drop' && carry && s.carry && carry.tab.id === s.tabId) s.carry = carry
      if (s.over && !alive(s.over.win)) leave(s)
      // DROPPED OUTSIDE EVERY STRIP, a tab of several: the floating page is
      // handed the tab now and nothing is committed until it has drawn it.
      // The window stays where it was dropped, hidden, until then; then it
      // commits, shows and takes the focus, and only then does the source
      // let the tab go. A page that never comes (10 s) commits nothing: the
      // source still has the tab, unsaved text and all.
      if (how === 'drop' && s.kind === 'float' && !s.over && alive(s.win) && alive(s.source)) {
        stopLoop()
        session = null
        // The ghost stays where it was dropped, holding the tab, until the
        // window shows or the tab stays (review 2026-10-30).
        const ghost = s.ghost !== 'off' ? ghostTurn : null
        s.ghost = 'off'
        s.gb = null
        // In two pages from now until the commit: its state is main's still,
        // and the floating page may ask for it.
        deps.moving(s.tabId, true)
        deps.log?.('tear-drop-waits', { tab: s.tabId })
        return new Promise((resolve) => {
          const l: Late<W> = {
            tabId: s.tabId,
            source: s.source,
            win: s.win,
            carry: s.carry,
            sent: false,
            at: cursorOf(s),
            grab: s.grab,
            origin: s.origin,
            size: s.size,
            ghost,
            timer: null,
            resolve
          }
          late = l
          l.timer = after(() => {
            if (late === l) settleLate(false)
          }, TEAR.lateDropMs)
          if (deps.listening(l.win)) {
            l.sent = true
            deps.adopt(l.win, l.carry)
          }
        })
      }
      return Promise.resolve({ committed: finish(how, true) })
    },
    gone(win) {
      dead.add(win)
      const t = emptied.get(win)
      if (t !== undefined) {
        emptied.delete(win)
        // After the registry has forgotten it (this runs before `remove`).
        after(() => deps.moving(t, false), 0)
      }
      drop(win, true)
    },
    lost(win) {
      // Only as the source or the strip hovered in: a fresh floating window's
      // page starting to load is how it begins, not a loss.
      drop(win, false)
    },
    busy: (win) => (session?.kind === 'float' && session.win === win) || late?.win === win,
    slot(win, tabId, at) {
      const o = session?.over
      if (o && o.win === win && session?.tabId === tabId && Number.isInteger(at) && at >= 0) o.slot = at
    },
    e2eAt(win, at) {
      if (!deps.e2e) return
      if (at) placed.set(win, { x: at.x, y: at.y })
      else placed.delete(win)
    },
    state: () => {
      const s = session
      return {
        phase: s?.kind ?? 'idle',
        tabId: s?.tabId ?? null,
        bounds: s?.last ?? null,
        shown: s ? s.ghost === 'up' : false,
        ghost: s?.gb ? { ...s.gb } : null,
        waiting: late !== null,
        over: nameOf(s?.over?.win),
        slot: s?.over?.slot ?? null,
        front: s ? nameOf(candidates(s)[0]) : null,
        moved: moved ? { ...moved } : null,
        ...counts
      }
    }
  }
}
