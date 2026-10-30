import { TEAR, setBoundsSure, tabSize, validTabLook, type Bounds, type Size, type TabLook } from '@shared/tabTear'

/**
 * THE GHOST: THE TAB YOU ARE CARRYING, ON ITS OWN (owner, 2026-10-30, after
 * trying the live window by hand: "i dont wanna be carrying a full window ...
 * actually let it just be the tab you're carrying, that's how file explorer
 * does it"). While a torn tab is outside every strip, only this follows the
 * cursor: a tiny native window drawing the tab as the strip draws it (its
 * folder icon, its label, the theme's ground and ink, lifted with a soft
 * shadow). The full window stays hidden under the drag and shows at the drop.
 *
 * The window never takes the focus or the pointer (frameless, opaque but see-through,
 * unfocusable, out of the taskbar, click-through) and sits above every app
 * (`screen-saver`), so it can never be hidden behind the source the way a
 * shown-inactive spare was. Main moves it from the tear's 8 ms loop, in DIP,
 * the size passed each time (mixed DPI). It is made with the spare (warm, so
 * the first tear shows it at once) and placed BEFORE it shows.
 *
 * Its page is a fixed data: page with a CSP that allows no script, no fetch
 * and no image; no preload, sandboxed. What changes per tear (the label, the
 * size, the colours) goes in through `executeJavaScript` as ONE JSON value
 * that a fixed function reads: the label is set as `textContent`, the colours
 * as CSSOM properties (each already a checked colour, `validTabLook`), so a
 * folder named `<img onerror=...>` is only ever text.
 *
 * Under --e2e it is parked and clear like every window (`make` does that) and
 * never moved; it still shows and hides, and where it WOULD be is kept, so the
 * e2e can read both (`state`, `label`).
 */

/** What the ghost needs of a BrowserWindow. */
export interface GhostWin {
  isDestroyed(): boolean
  isVisible(): boolean
  getBounds(): Bounds
  setBounds(b: Bounds): void
  setOpacity(o: number): void
  showInactive(): void
  hide(): void
  moveTop(): void
  destroy(): void
  webContents: { executeJavaScript(code: string): Promise<unknown> }
}

export interface TabGhostDeps<W extends GhostWin> {
  e2e: boolean
  /** Make the window and load `GHOST_PAGE`: `ready` once it has loaded,
   *  `gone` if it closes or its page dies (it is made again when wanted). */
  make(ready: () => void, gone: () => void): W
  /** The theme's opaque ground, under a see-through strip colour. */
  base(): string
  /** A light theme (the colours when the page sent none). */
  light?(): boolean
  log?(event: string, fields: Record<string, string | number | boolean>): void
  /** One-shot timer (the wait for a first frame). */
  after?(fn: () => void, ms: number): unknown
  cancel?(handle: unknown): void
}

/** What a tear shows. */
export interface GhostFace {
  label: string
  size: Size
  look?: TabLook
}

export interface GhostState {
  made: boolean
  ready: boolean
  /** The window is shown (under --e2e: shown parked and clear). */
  visible: boolean
  /** Where it is, or under --e2e would be; null when not wanted. */
  bounds: Bounds | null
  label: string | null
}

export interface TabGhost {
  /** Make the window now if there is none (with the spare). */
  warm(): void
  /** Show it at `at` with this face; `shown` once it is on screen with that
   *  face drawn (its page painted it, then drew a frame shown). */
  show(face: GhostFace, at: Bounds, shown: () => void): void
  move(at: Bounds): void
  hide(): void
  /** Gone for good (the last window closed). */
  destroy(): void
  state(): GhostState
  /** The label its page shows (the e2e reads it back). */
  label(): Promise<string | null>
}

/** The solid folder the tab you are on wears (TabKindIcon.tsx, FOLDER_SOLID). */
const FOLDER_SOLID =
  'M2.5 6.5A1.5 1.5 0 0 1 4 5h5.2l2 2H20a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5z'

/** The ghost's colours when the page sent none (or none that passed). */
export const fallbackLook = (light: boolean): TabLook =>
  light
    ? { ground: '#f7f7f9', ink: '#1b1d22', edge: 'rgba(0, 0, 0, 0.12)', accent: '#3b82f6', font: 'Segoe UI Variable, Segoe UI, sans-serif' }
    : { ground: '#1a1d23', ink: '#e8e9ec', edge: 'rgba(255, 255, 255, 0.10)', accent: '#60a5fa', font: 'Segoe UI Variable, Segoe UI, sans-serif' }

/**
 * The page: no script of its own, nothing loaded from anywhere.
 * The tab: the strip's TabGhost lifted (TabStrip.tsx): 12 px text, the icon
 * and a gap of 6, padding 10, the accent rule along the top, radius 4.
 */
export const GHOST_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
html,body{margin:0;padding:0;background:#1a1d23;overflow:hidden;user-select:none;cursor:default}
#t{position:fixed;left:${TEAR.ghostPad}px;top:${TEAR.ghostPad}px;width:${TEAR.tabWidth}px;height:${TEAR.tabHeight}px;box-sizing:border-box;
display:flex;align-items:center;gap:6px;padding:0 10px;overflow:hidden;font-size:12px;
font-family:'Segoe UI Variable','Segoe UI',sans-serif;color:#e8e9ec;background:#1a1d23;
box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
#m{position:absolute;left:0;right:0;top:0;height:2px;background:#60a5fa}
#i{flex:none;width:14px;height:14px}
#l{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
</style></head><body><div id="t"><span id="m"></span><svg id="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${FOLDER_SOLID}" fill="currentColor"/></svg><span id="l"></span></div></body></html>`

export const GHOST_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(GHOST_HTML)}`

/** What the page is handed: one JSON value, read by a fixed function. */
interface Paint {
  label: string
  w: number
  h: number
  pad: number
  ground: string
  base: string
  ink: string
  edge: string
  accent: string
  font: string
}

/** The fixed function that paints the ghost. `v` is data: text goes in as
 *  `textContent`, colours as single CSSOM properties. */
const PAINT = `(function (v) {
  var t = document.getElementById('t'), l = document.getElementById('l'), m = document.getElementById('m');
  if (!t || !l || !m) return false;
  l.textContent = v.label;
  var s = t.style;
  s.left = v.pad + 'px'; s.top = v.pad + 'px'; s.width = v.w + 'px'; s.height = v.h + 'px';
  s.color = v.ink;
  s.fontFamily = v.font + ", 'Segoe UI Variable', 'Segoe UI', sans-serif";
  s.backgroundColor = v.base;
  s.backgroundImage = 'linear-gradient(' + v.ground + ', ' + v.ground + ')';
  s.boxShadow = 'inset 0 0 0 1px ' + v.edge;
  document.body.style.backgroundColor = v.base;
  m.style.backgroundColor = v.accent;
  return true;
})`

/** The script for one face. JSON is a JS expression: the label is a string
 *  literal in it, whatever it holds. */
export function paintScript(face: GhostFace, base: string, light = false): string {
  const look = face.look && validTabLook(face.look) ? face.look : fallbackLook(light)
  const size = tabSize(face.size)
  const paint: Paint = {
    label: Array.from(face.label).slice(0, TEAR.ghostLabelMax).join(''),
    w: Math.max(1, Math.round(size.width)),
    h: Math.max(1, Math.round(size.height)),
    pad: TEAR.ghostPad,
    ground: look.ground,
    base,
    ink: look.ink,
    edge: look.edge,
    accent: look.accent,
    font: look.font
  }
  return `${PAINT}(${JSON.stringify(paint)})`
}

/** Resolves once the page has drawn a frame on screen: the second
 *  animation frame starts after the first has been handed to the screen. A
 *  hidden window runs none, so only ask a shown one. Run through
 *  `executeJavaScript`, which a page's CSP does not stop. */
export const ONE_FRAME = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`

export function createTabGhost<W extends GhostWin>(deps: TabGhostDeps<W>): TabGhost {
  const after = deps.after ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const cancel = deps.cancel ?? ((h: unknown) => clearTimeout(h as NodeJS.Timeout))
  let win: W | null = null
  let ready = false
  /** The script the page last ran: the same face again needs no repaint. */
  let painted: string | null = null
  /** The show asked for and not hidden since. */
  let want: { script: string; shown: () => void } | null = null
  let at: Bounds | null = null
  /** The window is shown (maybe still clear, waiting for its first frame). */
  let up = false
  /** It is shown AND has drawn this face: `shown` has been called. */
  let lit = false
  let lastFace: string | null = null

  const live = (): W | null => (win && !win.isDestroyed() ? win : null)
  const ensure = (): void => {
    if (live()) return
    ready = false
    painted = null
    up = false
    lit = false
    const made: W = deps.make(
      () => {
        if (win !== made) return
        ready = true
        flush()
      },
      () => {
        if (win !== made) return
        win = null
        ready = false
        painted = null
        up = false
        lit = false
      }
    )
    win = made
  }
  /** Lit: opaque, and the tear is told it is on screen. */
  const light = (g: W, w: { script: string; shown: () => void }): void => {
    if (live() !== g || want !== w || !up || lit) return
    if (!deps.e2e) g.setOpacity(TEAR.ghostOpacity)
    lit = true
    deps.log?.('tear-ghost', { shown: true, x: at?.x ?? 0, y: at?.y ?? 0, w: at?.width ?? 0, h: at?.height ?? 0 })
    w.shown()
  }
  /**
   * On screen: placed BEFORE it shows (so it never flashes somewhere else
   * first), shown CLEAR, and made opaque only once its page has drawn a frame
   * on screen. A hidden window draws nothing, so Chromium would otherwise put
   * up the surface it kept from the last time it was shown: the previous
   * tab's label and colours for a frame or two (review 2026-10-30).
   */
  const reveal = (w: { script: string; shown: () => void }): void => {
    const g = live()
    if (!g || want !== w || up) return
    if (at && !deps.e2e) setBoundsSure(g, at)
    if (!deps.e2e) g.setOpacity(0)
    g.showInactive()
    if (!deps.e2e) g.moveTop()
    up = true
    lit = false
    let done = false
    let timer: unknown = null
    const go = (): void => {
      if (done) return
      done = true
      if (timer !== null) cancel(timer)
      light(g, w)
    }
    // A page that never draws (it should) still lights up.
    timer = after(go, TEAR.drawnMs)
    g.webContents.executeJavaScript(ONE_FRAME).then(go, go)
  }
  const flush = (): void => {
    const g = live()
    const w = want
    if (!g || !ready || !w) return
    if (painted === w.script) return reveal(w)
    g.webContents.executeJavaScript(w.script).then(
      (ok) => {
        if (ok !== true) return deps.log?.('tear-ghost', { painted: false })
        if (live() !== g) return
        painted = w.script
        reveal(w)
      },
      () => deps.log?.('tear-ghost', { painted: false })
    )
  }
  const off = (): void => {
    const g = live()
    if (g && up) g.hide()
    up = false
    lit = false
  }

  return {
    warm: ensure,
    show(face, b, shown) {
      ensure()
      at = { ...b }
      const script = paintScript(face, deps.base(), deps.light?.() ?? false)
      lastFace = face.label
      if (want && want.script === script) {
        // The same face asked for again (a tear while the last drop's ghost
        // still waits to go): this caller is the one told.
        want.shown = shown
        if (lit) shown()
        return
      }
      // Another face: whatever is on screen goes first, and comes back with it.
      off()
      want = { script, shown }
      flush()
    },
    move(b) {
      at = { ...b }
      const g = live()
      // Size passed every time: a move across displays of different scales
      // must not resize it.
      if (g && up && want && !deps.e2e) g.setBounds(b)
    },
    hide() {
      want = null
      at = null
      lastFace = null
      off()
    },
    destroy() {
      want = null
      at = null
      const g = live()
      win = null
      ready = false
      painted = null
      up = false
      lit = false
      if (g) g.destroy()
    },
    state() {
      const g = live()
      return {
        made: !!g,
        ready,
        visible: !!g && g.isVisible(),
        bounds: want && at ? { ...at } : null,
        label: want ? lastFace : null
      }
    },
    async label() {
      const g = live()
      if (!g || !ready) return null
      try {
        const t = await g.webContents.executeJavaScript(`document.getElementById('l')?.textContent ?? null`)
        return typeof t === 'string' ? t : null
      } catch {
        return null
      }
    }
  }
}
