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
  shouldTear,
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
 * main owns the window. One IPC (`tabs:tear`), then:
 *
 * - A tab of several: ONLY THE TAB follows the cursor (owner, 2026-10-30: "i
 *   dont wanna be carrying a full window ... actually let it just be the tab
 *   you're carrying, that's how file explorer does it"): a tab-sized GHOST
 *   window (tabGhost.ts), held at the same grab point as in the strip, above
 *   every app and never focused, so the source keeps the pointer. Main moves
 *   it every 8 ms from the cursor (`screen.getCursorScreenPoint`), the size
 *   passed each time for a mixed-DPI move; never from the renderer's events
 *   over IPC. The warm spare (or a fresh window if there is none) is handed
 *   the tab at the tear and stays HIDDEN all through the drag; where it would
 *   go is worked out every tick, and it is placed there, so its tab sits under
 *   the cursor where the ghost was, only at the drop.
 * - The window's only tab: the WHOLE window follows instead (spec 1.7); a
 *   maximized one is restored to its normal size under the cursor first.
 * - Over the source's own strip (its rect plus 8 DIP) for 120 ms, the tab
 *   attaches again: the ghost hides, the floating window gives the tab back
 *   (it is the spare again), and the strip carries on as a reorder.
 * - STEP 4, OVER ANY OTHER WINDOW'S STRIP (spec 1.4, 1.7) for the same 120 ms,
 *   the tab attaches THERE, live: the ghost hides (the only tab's window goes
 *   clear instead: it holds the pointer, so it must not hide), and
 *   that strip opens a gap at the slot under the cursor and draws the tab in
 *   it (`hover`, every tick the cursor moves). Fully out of that strip again
 *   (the tear's own rule and hysteresis, `attachRects`), it tears off again:
 *   the ghost is back under the cursor. Released there, the tab is
 *   MERGED into that window at its slot, selected, that window in front; the
 *   only tab's emptied window closes. Its state moves exactly as in a tear:
 *   the same id, what it carried, `handTab` at the commit, nothing released.
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
 *   blur, a window closing) hides the ghost, gives the tab back, closes any
 *   gap it had opened in another strip, and puts a moved window where it was.
 *   Nothing half-done is ever committed: a drop on a fresh window whose page
 *   has not drawn the tab yet waits for it, and a page that never comes (10 s)
 *   gives the tab back.
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
  maximize(): void
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
  /** The tab flies: its main-side state stays whoever closes. */
  moving(tabId: string, on: boolean): void
  /** The drop: the floating window becomes a window of the session, and the
   *  tab is no longer `source`'s. */
  commit(win: W, carry: TabCarry, source: W): void
  /** Show a committed window and bring it to the front, focused (under
   *  --e2e only shown). */
  reveal(win: W): void
  /** The floating window gives the tab back and hides as the spare. `to` is
   *  who has the tab now: the source, the window it merged into, or null when
   *  the source has closed (nobody has it). */
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
  /** The only tab's moving window goes clear (and back): it holds the pointer,
   *  so it is never hidden. */
  fade?(win: W, out: boolean): void
  /** The only tab merged away: its emptied window closes, asking nothing. */
  closeEmptied?(win: W): void
  log?(event: string, fields: Record<string, string | number | boolean>): void
  now?(): number
  every?(fn: () => void, ms: number): unknown
  stop?(handle: unknown): void
  /** One-shot timer (the late drop's wait). */
  after?(fn: () => void, ms: number): unknown
  cancel?(handle: unknown): void
}

/** A drop that came before the floating page had drawn the tab (a fresh
 *  window still loading): nothing is committed until it has. */
interface Late<W> {
  tabId: string
  source: W
  win: W
  carry: TabCarry
  sent: boolean
  last: Bounds | null
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
   *  moves its window and merges nowhere). */
  carry: TabCarry | null
  /** The press inside the tab, and where the new page's first tab sits. */
  grab: Point
  origin: Point
  /** The moving window's size. */
  size: { width: number; height: number }
  /** The carried tab's own size, label and look. */
  tab: Size
  label: string
  look: TabLook | undefined
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
}
interface Floating<W> extends Common<W> {
  kind: 'float'
  win: W
  carry: TabCarry
  strip: Rect
  sent: boolean
  /** Its page has drawn the tab. */
  ready: boolean
  /** The ghost: off (in a strip, or ended), asked for, or on screen. */
  ghost: 'off' | 'asked' | 'up'
  /** Where the ghost is (or, under --e2e, would be). */
  gb: Bounds | null
}
interface Moving<W> extends Common<W> {
  kind: 'window'
  before: Bounds
  wasMax: boolean
  /** Clear while its tab is in another window's strip. */
  faded: boolean
}
type Session<W> = (Floating<W> | Moving<W>) & { point: Point; last: Bounds | null }
type Float<W> = Floating<W> & { point: Point; last: Bounds | null }

/** What the e2e reads (`__e2eTear`). */
export interface TearState {
  phase: 'idle' | 'float' | 'window'
  tabId: string | null
  /** Where the moving window is (or, under --e2e, would be). For a tab of
   *  several: where the hidden floating window goes at the drop. */
  bounds: Bounds | null
  /** What follows the cursor is on screen: the ghost (a tab of several). */
  shown: boolean
  /** Where the ghost is (or would be) while it is asked for; null otherwise. */
  ghost: Bounds | null
  /** A drop is waiting for a fresh window's page to draw the tab. */
  waiting: boolean
  /** The window whose strip the tab is in now (step 4), by name. */
  over: string | null
  /** The slot that strip has open for it. */
  slot: number | null
  /** The window in front, as the tear sees it. */
  front: string | null
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
}

export interface TearOff<W extends TearWin> {
  start(source: W, req: TearRequest): boolean
  /** The page's pointer, client coordinates (--e2e only). */
  point(source: W, client: Point): void
  /** A spare's page has started listening. */
  listening(win: W): void
  /** The floating page has drawn the tab; `tab` is where (client coordinates). */
  adopted(win: W, tab: Point | null): void
  /** A drop before the floating page has the tab answers once it has (or
   *  has failed to load): only then is anything committed. */
  end(source: W, how: TearEnd): Promise<{ committed: boolean }>
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
  /** A drop that came before the floating page had the tab (a slow fresh
   *  window): committed, shown and answered when the page has drawn it. */
  let late: Late<W> | null = null
  /** Windows that have closed. Electron's 'closed' comes before the window is
   *  destroyed, so `isDestroyed` alone would still call it alive there. */
  const dead = new WeakSet<W>()
  const alive = (w: W): boolean => !dead.has(w) && !w.isDestroyed()
  /** Emptied by a merge and closing: the tab they held stays marked moving
   *  until the registry has forgotten them, so their close releases nothing. */
  const emptied = new Map<W, string>()
  /** Under --e2e: where each parked window pretends to be. */
  const placed = new WeakMap<W, Point>()
  const counts = { tears: 0, commits: 0, attaches: 0, cancels: 0, enters: 0, leaves: 0, merges: 0, raises: 0 }

  const frame = (w: W): Point => {
    const b = w.getBounds()
    const c = w.getContentBounds()
    return { x: c.x - b.x, y: c.y - b.y }
  }
  /** The point the window is held by, in window coordinates. */
  const hold = (s: Session<W>, w: W): Point => {
    const f = frame(w)
    return { x: f.x + s.origin.x + s.grab.x, y: f.y + s.origin.y + s.grab.y }
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
  const place = (s: Session<W>, w: W): void => {
    const p = cursorOf(s)
    const b = floatBounds(p, hold(s, w), s.size, deps.workArea(p))
    if (same(s.last, b)) return
    s.last = b
    // The floating window is hidden all through the drag: `last` is where it
    // goes at the drop. Under --e2e no window moves.
    // Size passed every time: a move across displays of different scales
    // must not resize it (Electron can, on Windows).
    if (s.kind === 'window' && !deps.e2e) w.setBounds(b)
  }

  /* ----- THE GHOST (owner, 2026-10-30): only the tab follows the cursor ----- */
  const ghostAt = (s: Session<W>): Bounds => ghostBounds(cursorOf(s), s.grab, s.tab)
  /** Out of every strip: the ghost shows under the cursor. */
  const showGhost = (s: Float<W>): void => {
    if (s.ghost !== 'off' || s.over) return
    s.ghost = 'asked'
    s.gb = ghostAt(s)
    if (!deps.ghost) return
    deps.ghost.show({ label: s.label, size: s.tab, look: s.look }, s.gb, () => {
      if (session !== s || s.ghost !== 'asked') return
      s.ghost = 'up'
      deps.tell(s.source, { kind: 'shown', tabId: s.tabId })
    })
  }
  /** In a strip, dropped, or ended: the ghost goes at once. */
  const hideGhost = (s: Float<W>): void => {
    if (s.ghost === 'off') return
    s.ghost = 'off'
    s.gb = null
    deps.ghost?.hide()
  }
  const moveGhost = (s: Float<W>): void => {
    if (s.ghost === 'off') return
    const b = ghostAt(s)
    if (same(s.gb, b)) return
    s.gb = b
    deps.ghost?.move(b)
  }

  /** The windows the cursor can be over, front to back: never the window
   *  that is moving with it (the floating one, or the only tab's own). Under
   *  --e2e a window other than the source counts only once it is placed. */
  const candidates = (s: Session<W>): W[] =>
    s.z.filter(
      (w) =>
        alive(w) &&
        !(s.kind === 'float' && w === s.win) &&
        !(s.kind === 'window' && w === s.source) &&
        (!deps.e2e || w === s.source || placed.has(w))
    )
  /** The strip a window takes the tab by, on screen: the source's own as its
   *  page sent it with the tear (held to the tear zone, `snapTarget`), any
   *  other's as its page reported it. */
  const snapOf = (s: Session<W>, w: W): Rect | null => {
    if (w === s.source) return s.kind === 'float' ? shift(s.strip, clientToScreen(w, { x: 0, y: 0 })) : null
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
  /** The window whose strip is under the cursor, front to back: a window's
   *  body hides every strip behind it, and so does another app's window. */
  const stripHit = (s: Session<W>, p: Point): W | null => {
    for (const w of candidates(s)) {
      const snap = snapOf(s, w)
      if (snap && inside(p, grow(snap, TEAR.snapMargin)) && !covered(p, w)) return w
      if (inside(p, screenRect(w))) return null
    }
    return null
  }
  /** The window the cursor is over, front-most; none where another app's
   *  window is in front of it. */
  const windowHit = (s: Session<W>, p: Point): W | null => {
    const w = candidates(s).find((x) => inside(p, screenRect(x))) ?? null
    return w && !covered(p, w) ? w : null
  }
  /** Something in front of `w` is under the point: one of the session's
   *  windows, or another app's. */
  const hidden = (s: Session<W>, w: W, p: Point): boolean => {
    for (const x of candidates(s)) {
      if (x === w) break
      if (inside(p, screenRect(x))) return true
    }
    return covered(p, w)
  }
  /** Bring a window to the front without the focus (only the bookkeeping
   *  under --e2e, where nothing is on screen). */
  const lift = (w: W): void => {
    if (!deps.e2e) deps.raise?.(w)
    deps.raised?.(w)
  }

  /** THE RAISE (step 4): a window the cursor stays over for 750 ms comes to
   *  the front, without the focus, and is in front for the hit test too. */
  const raiseStep = (s: Session<W>, p: Point): void => {
    const under = s.over ? s.over.win : windowHit(s, p)
    if (!under || candidates(s)[0] === under) {
      s.rdwell = null
      return
    }
    const step = dwellStep(s.rdwell, under, now(), TEAR.raiseMs)
    s.rdwell = step.dwell
    if (!step.fire) return
    s.rdwell = null
    s.z = [under, ...s.z.filter((w) => w !== under)]
    counts.raises += 1
    lift(under)
    if (under !== s.source) s.lifted = true
    // What moves with the cursor stays above it (the ghost is above every
    // app already).
    if (!deps.e2e && s.kind === 'window') deps.raise?.(s.source)
    deps.log?.('tear-raise', { tab: s.tabId, win: nameOf(under) ?? '' })
  }

  const sendHover = (s: Session<W>, o: Over<W>, client: Point): void => {
    const key = `${client.x},${client.y}`
    if (o.sent === key) return
    o.sent = key
    deps.hover?.(o.win, { tabId: s.tabId, point: client, grab: s.grab, size: s.tab, label: s.label })
  }
  /** Into another window's strip (step 4): the window moving with the tab
   *  goes, and that strip opens a gap for it. */
  const enter = (s: Session<W>, w: W): void => {
    const o: Over<W> = { win: w, slot: null, sent: null }
    s.over = o
    s.dwell = null
    counts.enters += 1
    // That strip draws the tab in its gap: the ghost goes.
    if (s.kind === 'float') hideGhost(s)
    else if (!s.faded) {
      s.faded = true
      if (!deps.e2e) deps.fade?.(s.source, true)
    }
    deps.tell(s.source, { kind: 'over', tabId: s.tabId })
    sendHover(s, o, screenToClient(w, cursorOf(s)))
    deps.log?.('tear-over', { tab: s.tabId, win: nameOf(w) ?? '' })
  }
  /** Out of that strip again: its gap closes, and the window comes back under
   *  the cursor. */
  const leave = (s: Session<W>): void => {
    const o = s.over
    if (!o) return
    s.over = null
    s.dwell = null
    counts.leaves += 1
    if (alive(o.win)) deps.hover?.(o.win, null)
    deps.tell(s.source, { kind: 'off', tabId: s.tabId })
    if (s.kind === 'float') showGhost(s)
    else if (s.faded) {
      s.faded = false
      if (!deps.e2e) deps.fade?.(s.source, false)
    }
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
    if (s.kind === 'window') place(s, s.source)
    else {
      if (!alive(s.win)) return void finish('cancel', false)
      place(s, s.win)
      moveGhost(s)
    }
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
    if (hit === s.source) {
      if (s.kind === 'float') attach(s)
    } else enter(s, hit)
  }
  /** The tab is the source's again after a window was raised above it: the
   *  source, which still has the focus, comes back to the front. */
  const unbury = (s: Session<W>): void => {
    if (s.lifted && alive(s.source)) lift(s.source)
  }
  const attach = (s: Float<W>): void => {
    stopLoop()
    session = null
    counts.attaches += 1
    hideGhost(s)
    unbury(s)
    deps.release(s.win, s.tabId, s.source)
    deps.moving(s.tabId, false)
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
  /** A tab that does not leave: the floating window gives it back (if it is
   *  still there) and hides as the spare; the source has it again. */
  const giveBack = (tabId: string, win: W, source: W): void => {
    counts.cancels += 1
    // Even when the source has gone: the floating window is the spare again,
    // and main releases the tab with the source's close (`gone` first).
    if (alive(win)) deps.release(win, tabId, alive(source) ? source : null)
    deps.moving(tabId, false)
    deps.log?.('tear-end', { tab: tabId, how: 'cancel' })
  }
  /** The late drop is over: the page drew the tab (`ok`), or the window failed
   *  to load in time, or one of the two windows went. */
  const settleLate = (ok: boolean): void => {
    const l = late
    if (!l) return
    late = null
    cancelTimer(l.timer)
    if (ok && alive(l.win) && alive(l.source)) {
      commit(l.tabId, l.win, l.carry, l.source)
      if (l.last && !deps.e2e) l.win.setBounds(l.last)
      l.win.showInactive()
      deps.reveal(l.win)
      l.resolve({ committed: true })
      return
    }
    // "The new window failing to load commits nothing" (spec): the source
    // still has the tab, with everything it carried.
    giveBack(l.tabId, l.win, l.source)
    l.resolve({ committed: false })
  }
  /** THE DROP INTO ANOTHER WINDOW'S STRIP (step 4): that window has the tab,
   *  at the slot its strip had open, selected and in front. The floating
   *  window is the spare again; the only tab's emptied window closes. */
  const merge = (s: Session<W>, o: Over<W>, carry: TabCarry): void => {
    counts.merges += 1
    if (s.kind === 'float') {
      if (alive(s.win)) deps.release(s.win, s.tabId, o.win)
    } else {
      // Its window closes next: the tab stays marked moving until the
      // registry has forgotten that window, so the close releases nothing.
      emptied.set(s.source, s.tabId)
      deps.moving(s.tabId, true)
    }
    deps.merge?.(o.win, carry, s.source, o.slot)
    if (s.kind === 'float') deps.moving(s.tabId, false)
    else deps.closeEmptied?.(s.source)
    deps.reveal(o.win)
    deps.log?.('tear-end', { tab: s.tabId, how: 'merge', into: nameOf(o.win) ?? '', at: o.slot ?? -1 })
  }
  /** End the session; answers whether a drop committed. `fromPage`: the
   *  source page ended it (its pointer-up, its cancel); otherwise main did,
   *  and the page is told so it puts the tab back. */
  const finish = (how: TearEnd, fromPage: boolean): boolean => {
    const s = session
    if (!s) return false
    stopLoop()
    session = null
    const o = s.over
    if (o && how === 'drop' && s.carry && alive(o.win) && alive(s.source)) {
      if (s.kind === 'float') hideGhost(s)
      merge(s, o, s.carry)
      return true
    }
    // Any gap it had opened in another strip closes.
    if (o && alive(o.win)) deps.hover?.(o.win, null)
    if (s.kind === 'window') {
      if (s.faded && alive(s.source) && !deps.e2e) deps.fade?.(s.source, false)
      if (how === 'cancel') {
        counts.cancels += 1
        // Put back exactly: the place it was, and maximized if it was.
        if (alive(s.source)) {
          if (!deps.e2e) s.source.setBounds(s.before)
          if (s.wasMax) s.source.maximize()
        }
      }
      if (!fromPage && alive(s.source)) deps.tell(s.source, { kind: 'ended', tabId: s.tabId })
      deps.log?.('tear-end', { tab: s.tabId, how, only: true })
      return false
    }
    if (how === 'drop' && !o && alive(s.win) && alive(s.source)) {
      commit(s.tabId, s.win, s.carry, s.source)
      // Placed so its tab sits under the cursor where the ghost was, BEFORE
      // it shows; then in front, and only then does the ghost go (no frame
      // with neither).
      place(s, s.win)
      if (s.last && !deps.e2e) s.win.setBounds(s.last)
      deps.reveal(s.win)
      hideGhost(s)
      return true
    }
    hideGhost(s)
    giveBack(s.tabId, s.win, s.source)
    unbury(s)
    if (!fromPage && alive(s.source)) deps.tell(s.source, { kind: 'ended', tabId: s.tabId })
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
      const z = [...(deps.windowsFront?.() ?? [])]
      if (!z.includes(source)) z.unshift(source)
      const common = {
        tabId: req.tabId,
        source,
        grab: req.grab,
        origin: req.origin,
        tab: req.size ?? { width: TEAR.tabWidth, height: TEAR.tabHeight },
        label: req.label ?? labelOf(req.carry ?? null),
        look: validTabLook(req.look) ? req.look : undefined,
        dwell: null,
        over: null,
        z,
        rdwell: null,
        lifted: false,
        point,
        last: null
      }
      if (req.only) {
        const wasMax = source.isMaximized()
        const before = source.getNormalBounds()
        // Like a title-bar drag of a maximized window: it comes off at its
        // normal size, under the cursor.
        if (wasMax) source.unmaximize()
        const s: Session<W> = {
          ...common,
          kind: 'window',
          carry: req.carry ?? null,
          size: floatSize(before, false, deps.workArea(deps.e2e ? point : deps.cursor())),
          before,
          wasMax,
          faded: false
        }
        session = s
        place(s, source)
      } else {
        const carry = req.carry
        if (!carry) return false
        const win = deps.takeSpare()
        const p = deps.e2e ? point : deps.cursor()
        const s: Session<W> = {
          ...common,
          kind: 'float',
          win,
          carry,
          size: floatSize(source.getNormalBounds(), source.isMaximized(), deps.workArea(p)),
          strip: req.strip,
          sent: false,
          ready: false,
          ghost: 'off',
          gb: null
        }
        session = s
        deps.moving(req.tabId, true)
        place(s, win)
        if (deps.listening(win)) {
          s.sent = true
          deps.adopt(win, carry)
        }
        // Only the tab follows the cursor, from this moment.
        showGhost(s)
      }
      deps.log?.('tear-start', { tab: req.tabId, only: req.only })
      loop = every(tick, TEAR.tickMs)
      return true
    },
    point(source, client) {
      if (session && session.source === source) session.point = clientToScreen(source, client)
    },
    listening(win) {
      if (session?.kind === 'float' && session.win === win && !session.sent) {
        session.sent = true
        deps.adopt(win, session.carry)
      } else if (late && late.win === win && !late.sent) {
        late.sent = true
        deps.adopt(win, late.carry)
      }
    },
    adopted(win, tab) {
      if (session?.kind === 'float' && session.win === win) {
        // Its own strip, as drawn: the cursor holds THAT tab from now on.
        // It stays hidden until the drop (the ghost is what follows).
        if (tab) session.origin = tab
        session.ready = true
        session.last = null
        place(session, win)
      } else if (late && late.win === win) settleLate(true)
    },
    end(source, how) {
      const s = session
      if (!s || s.source !== source) return Promise.resolve({ committed: false })
      if (s.over && !alive(s.over.win)) leave(s)
      // DROPPED BEFORE THE NEW WINDOW HAS THE TAB (a fresh window, its page
      // still loading; review 2026-10-29): nothing is committed yet. The
      // window stays where it was dropped, hidden, until its page has drawn
      // the tab; then it commits, shows and takes the focus, and only then
      // does the source let the tab go. A page that never comes commits
      // nothing: the tab goes back, unsaved text and all. (Dropped in another
      // window's strip, the floating page does not matter: it merges there.)
      if (how === 'drop' && s.kind === 'float' && !s.over && !s.ready && alive(s.win) && alive(s.source)) {
        stopLoop()
        session = null
        // The ghost goes at the drop; the window shows once its page is ready.
        hideGhost(s)
        deps.log?.('tear-drop-waits', { tab: s.tabId })
        return new Promise((resolve) => {
          late = {
            tabId: s.tabId,
            source: s.source,
            win: s.win,
            carry: s.carry,
            sent: s.sent,
            last: s.last,
            timer: after(() => settleLate(false), TEAR.lateDropMs),
            resolve
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
        shown: s?.kind === 'float' ? s.ghost === 'up' : false,
        ghost: s?.kind === 'float' && s.gb ? { ...s.gb } : null,
        waiting: late !== null,
        over: nameOf(s?.over?.win),
        slot: s?.over?.slot ?? null,
        front: s ? nameOf(candidates(s)[0]) : null,
        ...counts
      }
    }
  }
}
