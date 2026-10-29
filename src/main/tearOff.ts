import {
  TEAR,
  dwellStep,
  floatBounds,
  floatSize,
  stripUnder,
  type Bounds,
  type Dwell,
  type Point,
  type Rect,
  type TabCarry,
  type TearEnd,
  type TearEvent,
  type TearRequest
} from '@shared/tabTear'

/**
 * TAB TEAR-OFF, MAIN'S HALF (step 3, owner, 2026-10-29; spec
 * docs/superpowers/specs/2026-10-29-tab-tearoff-design.md section 1).
 *
 * The strip keeps the pointer (its capture holds while the button is down, even
 * with the cursor outside the window) and decides the TEAR; from that moment
 * main owns the window. One IPC (`tabs:tear`), then:
 *
 * - A tab of several: the warm spare (or a fresh window if there is none) is
 *   sized and placed while hidden, handed the tab, and shown INACTIVE once its
 *   page has drawn it, so the source keeps the pointer. Main moves it every
 *   8 ms from the cursor (`screen.getCursorScreenPoint`), the size passed each
 *   time for a mixed-DPI move; never from the renderer's events over IPC.
 * - The window's only tab: the WHOLE window follows instead (spec 1.7); a
 *   maximized one is restored to its normal size under the cursor first.
 * - Over the source's own strip (its rect plus 8 DIP) for 120 ms, the tab
 *   attaches again: the floating window gives it back and hides as the spare,
 *   and the strip carries on as a reorder. The strips are hit-tested as a list
 *   (`stripUnder`), front-most first; step 3 lists the source alone, step 4
 *   (attach into any window) lists every window's.
 * - The page's pointer-up ends it: a drop makes the floating window a window of
 *   the session (focused) and only THEN does the source let the tab go; a
 *   cancel (Escape, right-click, lost capture, blur) gives it back and puts a
 *   moved window where it was. Nothing half-done is ever committed.
 *
 * In memory only: no disk, no process (syncCalls.test.ts, spawnCalls.test.ts).
 * Pure apart from what `TearDeps` hands it, so `tearOff.test.ts` drives it with
 * fake windows and fake time.
 *
 * Under --e2e no window is ever moved: the windows stay parked offscreen and
 * the cursor is the page's pointer (`point`), since Playwright's mouse is not
 * the system cursor. Where a window WOULD go is kept for the e2e (`state`).
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
  /** The drop: the floating window becomes a window of the session. */
  commit(win: W, carry: TabCarry): void
  /** Bring a committed window to the front, focused (never under --e2e). */
  reveal(win: W): void
  /** The floating window gives the tab back to `source` and hides as the spare. */
  release(win: W, tabId: string, source: W): void
  /** A word to the source page. */
  tell(source: W, event: TearEvent): void
  /** Make the next spare a moment from now. */
  spareSoon(): void
  log?(event: string, fields: Record<string, string | number | boolean>): void
  now?(): number
  every?(fn: () => void, ms: number): unknown
  stop?(handle: unknown): void
}

interface Floating<W> {
  kind: 'float'
  tabId: string
  source: W
  win: W
  carry: TabCarry
  /** The press inside the tab, and where the new page's first tab sits. */
  grab: Point
  origin: Point
  size: { width: number; height: number }
  strip: Rect
  sent: boolean
  shown: boolean
  dwell: Dwell<number> | null
}
interface Moving<W> {
  kind: 'window'
  tabId: string
  source: W
  grab: Point
  origin: Point
  size: { width: number; height: number }
  before: Bounds
  wasMax: boolean
}
type Session<W> = (Floating<W> | Moving<W>) & { point: Point; last: Bounds | null }

/** What the e2e reads (`__e2eTear`). */
export interface TearState {
  phase: 'idle' | 'float' | 'window'
  tabId: string | null
  /** Where the moving window is (or, under --e2e, would be). */
  bounds: Bounds | null
  shown: boolean
  /** Tears and their ends since the start, for the e2e's counts. */
  tears: number
  commits: number
  attaches: number
  cancels: number
}

export interface TearOff<W extends TearWin> {
  start(source: W, req: TearRequest): boolean
  /** The page's pointer, client coordinates (--e2e only). */
  point(source: W, client: Point): void
  /** A spare's page has started listening. */
  listening(win: W): void
  /** The floating page has drawn the tab; `tab` is where (client coordinates). */
  adopted(win: W, tab: Point | null): void
  end(source: W, how: TearEnd): { committed: boolean }
  /** A window has closed or crashed. */
  gone(win: W): void
  /** The spare in use, if any: it must not be destroyed or reused under the tear. */
  busy(win: W): boolean
  state(): TearState
}

const same = (a: Bounds | null, b: Bounds): boolean =>
  !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
const shift = (r: Rect, by: Point): Rect => ({ left: r.left + by.x, top: r.top + by.y, right: r.right + by.x, bottom: r.bottom + by.y })

export function createTearOff<W extends TearWin>(deps: TearDeps<W>): TearOff<W> {
  const now = deps.now ?? (() => Date.now())
  const every = deps.every ?? ((fn: () => void, ms: number) => setInterval(fn, ms))
  const stopTimer = deps.stop ?? ((h: unknown) => clearInterval(h as NodeJS.Timeout))
  let session: Session<W> | null = null
  let loop: unknown = null
  /** A drop that came before the floating page had the tab (a slow fresh
   *  window): it is delivered and shown when the page catches up. */
  let late: { win: W; carry: TabCarry; sent: boolean } | null = null
  const counts = { tears: 0, commits: 0, attaches: 0, cancels: 0 }

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
  const clientToScreen = (w: W, p: Point): Point => {
    const c = w.getContentBounds()
    return { x: c.x + p.x, y: c.y + p.y }
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
    // Under --e2e the window stays parked; `last` is where it would go.
    // Size passed every time: a move across displays of different scales
    // must not resize it (Electron can, on Windows).
    if (!deps.e2e) w.setBounds(b)
  }
  const tick = (): void => {
    const s = session
    if (!s) return stopLoop()
    if (s.source.isDestroyed()) return void finish('cancel', false)
    if (s.kind === 'window') return place(s, s.source)
    if (s.win.isDestroyed()) return void finish('cancel', false)
    place(s, s.win)
    // THE SNAP BACK (spec 1.4): over a strip, with its margin, for 120 ms.
    // One target for now: the source's own strip. Step 4 lists every window.
    const p = cursorOf(s)
    const targets = [{ key: 0, rect: shift(s.strip, clientToScreen(s.source, { x: 0, y: 0 })) }]
    const over = stripUnder(p, targets)
    const step = dwellStep(s.dwell, over ? over.key : null, now())
    s.dwell = step.dwell
    if (step.fire) attach(s)
  }
  const attach = (s: Floating<W> & { point: Point }): void => {
    stopLoop()
    session = null
    counts.attaches += 1
    deps.release(s.win, s.tabId, s.source)
    deps.moving(s.tabId, false)
    deps.tell(s.source, { kind: 'attached', tabId: s.tabId })
    deps.log?.('tear-attach', { tab: s.tabId })
  }
  const showFloating = (s: Floating<W> & { last: Bounds | null }): void => {
    if (s.shown || s.win.isDestroyed()) return
    s.shown = true
    // Placed BEFORE it shows, so it never flashes somewhere else first.
    if (s.last && !deps.e2e) s.win.setBounds(s.last)
    s.win.showInactive()
    deps.tell(s.source, { kind: 'shown', tabId: s.tabId })
  }
  /** End the session; answers whether a drop committed. `fromPage`: the
   *  source page ended it (its pointer-up, its cancel); otherwise main did,
   *  and the page is told so it puts the tab back. */
  const finish = (how: TearEnd, fromPage: boolean): boolean => {
    const s = session
    if (!s) return false
    stopLoop()
    session = null
    if (s.kind === 'window') {
      if (how === 'cancel') {
        counts.cancels += 1
        // Put back exactly: the place it was, and maximized if it was.
        if (!s.source.isDestroyed()) {
          if (!deps.e2e) s.source.setBounds(s.before)
          if (s.wasMax) s.source.maximize()
        }
      }
      if (!fromPage && !s.source.isDestroyed()) deps.tell(s.source, { kind: 'ended', tabId: s.tabId })
      deps.log?.('tear-end', { tab: s.tabId, how, only: true })
      return false
    }
    if (how === 'drop' && !s.win.isDestroyed() && !s.source.isDestroyed()) {
      counts.commits += 1
      deps.commit(s.win, s.carry)
      // Shown: to the front now. Not yet (a fresh window still loading): when
      // its page has drawn the tab.
      if (s.shown) deps.reveal(s.win)
      else late = { win: s.win, carry: s.carry, sent: s.sent }
      deps.moving(s.tabId, false)
      deps.spareSoon()
      deps.log?.('tear-end', { tab: s.tabId, how })
      return true
    }
    counts.cancels += 1
    // The floating window hides as the spare again, even when the source has
    // gone (a crash rebuild brings that window back with the tab in it).
    if (!s.win.isDestroyed()) deps.release(s.win, s.tabId, s.source)
    deps.moving(s.tabId, false)
    if (!fromPage && !s.source.isDestroyed()) deps.tell(s.source, { kind: 'ended', tabId: s.tabId })
    deps.log?.('tear-end', { tab: s.tabId, how: 'cancel' })
    return false
  }

  return {
    start(source, req) {
      if (source.isDestroyed()) return false
      if (session) finish('cancel', false)
      counts.tears += 1
      const point = clientToScreen(source, req.point)
      if (req.only) {
        const wasMax = source.isMaximized()
        const before = source.getNormalBounds()
        // Like a title-bar drag of a maximized window: it comes off at its
        // normal size, under the cursor.
        if (wasMax) source.unmaximize()
        const s: Session<W> = {
          kind: 'window',
          tabId: req.tabId,
          source,
          grab: req.grab,
          origin: req.origin,
          size: floatSize(before, false, deps.workArea(deps.e2e ? point : deps.cursor())),
          before,
          wasMax,
          point,
          last: null
        }
        session = s
        place(s, source)
      } else {
        const carry = req.carry
        if (!carry) return false
        const win = deps.takeSpare()
        const p = deps.e2e ? point : deps.cursor()
        const s: Session<W> = {
          kind: 'float',
          tabId: req.tabId,
          source,
          win,
          carry,
          grab: req.grab,
          origin: req.origin,
          size: floatSize(source.getNormalBounds(), source.isMaximized(), deps.workArea(p)),
          strip: req.strip,
          sent: false,
          shown: false,
          dwell: null,
          point,
          last: null
        }
        session = s
        deps.moving(req.tabId, true)
        place(s, win)
        if (deps.listening(win)) {
          s.sent = true
          deps.adopt(win, carry)
        }
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
        if (tab) session.origin = tab
        session.last = null
        place(session, win)
        showFloating(session)
      } else if (late && late.win === win) {
        late = null
        if (!win.isDestroyed()) {
          win.showInactive()
          deps.reveal(win)
        }
      }
    },
    end(source, how) {
      if (!session || session.source !== source) return { committed: false }
      return { committed: finish(how, true) }
    },
    gone(win) {
      if (late?.win === win) late = null
      const s = session
      if (!s) return
      if (s.source === win || (s.kind === 'float' && s.win === win)) finish('cancel', false)
    },
    busy: (win) => (session?.kind === 'float' && session.win === win) || late?.win === win,
    state: () => ({
      phase: session?.kind ?? 'idle',
      tabId: session?.tabId ?? null,
      bounds: session?.last ?? null,
      shown: session?.kind === 'float' ? session.shown : false,
      ...counts
    })
  }
}
