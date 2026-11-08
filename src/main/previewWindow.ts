import type { Bounds } from '@shared/tabTear'

/**
 * THE PREVIEW WINDOW, QUICK LOOK STYLE (owner, 2026-11-08: "build a setting to
 * have a preview which opens as a separate window. just like apple does it,
 * space opens and closes that too. it needs to animate and should not
 * disappear on alt tab, only on space").
 *
 * The window is the Explorer page's OWN child: the page opens it with
 * `window.open('about:blank', <armed name>)` and renders the preview's viewer
 * into it through a React portal, so the file is drawn by the same code, the
 * same grants (the fsmedia/fsaudio root wall, desktopAccess) and the same
 * process as the pane. Main only frames it: frameless, owned by the window it
 * came from (so it stays above it and never shows in the taskbar), centred
 * over it at about two thirds of its size, shown INACTIVE (the keyboard stays
 * in the list), faded in and out.
 *
 * A page may open exactly one, and only the window it armed a moment before:
 * `arm` hands the page a one-time name, and any other `window.open` (a
 * document's, a markdown link's) is still denied by the window's handler. It
 * is not a Prism window: it is in no registry, so it never counts for "the
 * last window closed", and it goes with its owner (closed, crashed, reloaded)
 * and with standby.
 *
 * Nothing here closes it on a blur: Alt+Tab or another app taking the focus
 * leaves it where it is. Only the page closes it (Space, Esc, its own close
 * button), or Alt+F4 on the window itself, which main tells the page.
 *
 * Under --e2e it is made unfocusable, clear and off the desktop like every
 * window, and its fade still runs on a recorded opacity (`e2e`), so a scenario
 * can see that it animates without anything appearing.
 */

/** The fade's length (owner: "it needs to animate"), Quick Look's quick zoom. */
export const PREVIEW_FADE_MS = 160
/** How much of the owner's size the window takes when it opens. */
export const PREVIEW_SHARE = 0.66
/** The smallest the window is made (and may be resized to). */
export const PREVIEW_MIN = { width: 360, height: 260 }
/** The frame name's stem; the armed name is `${stem}:${token}`. */
export const PREVIEW_FRAME = 'prism-preview'
/** How long an armed name is good for. */
export const PREVIEW_ARM_MS = 5000

/** Centred over the owner at `share` of its size, inside the work area when
 *  there is one (none under --e2e, where every window is off the desktop). */
export function previewBounds(owner: Bounds, work: Bounds | null, share = PREVIEW_SHARE): Bounds {
  let width = Math.max(PREVIEW_MIN.width, Math.round(owner.width * share))
  let height = Math.max(PREVIEW_MIN.height, Math.round(owner.height * share))
  let x = Math.round(owner.x + (owner.width - width) / 2)
  let y = Math.round(owner.y + (owner.height - height) / 2)
  if (work) {
    width = Math.min(width, work.width)
    height = Math.min(height, work.height)
    x = Math.min(Math.max(x, work.x), work.x + work.width - width)
    y = Math.min(Math.max(y, work.y), work.y + work.height - height)
  }
  return { x, y, width, height }
}

/** The opacities a fade from `from` to `to` passes through, one per frame of
 *  `frameMs`, eased out (fast, then settling), the last one `to` exactly. A
 *  fade of no length is that one step. */
export function fadeFrames(from: number, to: number, ms: number, frameMs = 16): number[] {
  const n = Math.max(1, Math.round(ms / frameMs))
  const out: number[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const eased = 1 - Math.pow(1 - t, 3)
    out.push(i === n ? to : Math.round((from + (to - from) * eased) * 1000) / 1000)
  }
  return out
}

/** The token of an armed frame name, or null for any other name. */
export function previewToken(frameName: string): string | null {
  const m = /^prism-preview:([a-z0-9]{16,64})$/.exec(frameName)
  return m ? m[1] : null
}

/** What the manager needs of a BrowserWindow (the owner and the child). */
export interface PreviewWin {
  id: number
  isDestroyed(): boolean
  isVisible(): boolean
  getBounds(): Bounds
  setOpacity(o: number): void
  showInactive(): void
  destroy(): void
  once(event: 'closed', fn: () => void): unknown
  webContents: { id: number }
}

export interface PreviewWindowsDeps<W extends PreviewWin> {
  e2e: boolean
  /** The theme's opaque ground, so the window never flashes another colour. */
  ground(): string
  /** The work area of the display under a window, null for none. */
  workArea(of: Bounds): Bounds | null
  /** A fresh unguessable token. */
  token(): string
  now(): number
  /** A repeating timer for the fade, and its stop. */
  every(fn: () => void, ms: number): unknown
  stop(handle: unknown): void
  /** The child closed by itself (Alt+F4): the owner's page is told. */
  closedByItself(owner: W): void
  log?(event: string, fields: Record<string, string | number | boolean>): void
}

/** One owner's preview window and what it is doing. */
interface Entry<W> {
  child: W
  /** The fade running now, if any. */
  fade: unknown
  /** The page asked for it to close (the close then is not "by itself"). */
  closing: boolean
  /** The opacity last set (or, under --e2e, that would have been). */
  opacity: number
}

export interface PreviewWindows<W extends PreviewWin> {
  /** A one-time frame name for `window.open` from `owner`'s page. */
  arm(owner: W): string
  /** The child's options when `frameName` is the name `owner` armed (it is
   *  used up); null for anything else, which the caller denies. */
  options(owner: W, url: string, frameName: string): Record<string, unknown> | null
  /** The child BrowserWindow, made from those options. */
  adopt(owner: W, child: W, frameName: string): void
  /** On screen, inactive, fading in (or at once). */
  show(owner: W, animate: boolean): void
  /** Fading out (or at once), then gone. */
  close(owner: W, animate: boolean): void
  /** The owner is closing, crashed or reloading: its child goes now. */
  ownerGone(owner: W): void
  /** Standby or quit: every child goes now. */
  destroyAll(): void
  /** The owner's child, if it has one. */
  of(owner: W): W | undefined
  /** For the e2e: each child, whether it shows, where, and the opacities its
   *  fades passed through. */
  e2e(): Array<{
    owner: number
    visible: boolean
    bounds: Bounds
    opacity: number
    fades: number[][]
  }>
  /** For the e2e: every fade since the start, the closed windows' too, as
   *  where it went and in how many frames. */
  e2eFades(): Array<{ to: number; frames: number }>
}

export function createPreviewWindows<W extends PreviewWin>(
  deps: PreviewWindowsDeps<W>
): PreviewWindows<W> {
  const armed = new Map<number, { token: string; at: number }>()
  const open = new Map<W, Entry<W>>()
  const fades = new WeakMap<W, number[][]>()
  const past: Array<{ to: number; frames: number }> = []
  const log = (event: string, fields: Record<string, string | number | boolean>): void =>
    deps.log?.(event, fields)

  const stopFade = (e: Entry<W>): void => {
    if (e.fade !== null) deps.stop(e.fade)
    e.fade = null
  }
  const setOpacity = (e: Entry<W>, o: number): void => {
    e.opacity = o
    // Clear under --e2e, whatever the fade says: nothing may appear.
    if (!e.child.isDestroyed()) e.child.setOpacity(deps.e2e ? 0 : o)
  }
  const kill = (owner: W): void => {
    const e = open.get(owner)
    if (!e) return
    stopFade(e)
    e.closing = true
    open.delete(owner)
    if (!e.child.isDestroyed()) e.child.destroy()
  }
  /** Run a fade on `e` to `to`, then `done`. */
  const fade = (e: Entry<W>, to: number, animate: boolean, done?: () => void): void => {
    stopFade(e)
    const frames = animate ? fadeFrames(e.opacity, to, PREVIEW_FADE_MS) : [to]
    let list = fades.get(e.child)
    if (!list) fades.set(e.child, (list = []))
    list.push(frames)
    past.push({ to, frames: frames.length })
    if (past.length > 40) past.shift()
    if (frames.length === 1) {
      setOpacity(e, to)
      done?.()
      return
    }
    let i = 0
    e.fade = deps.every(() => {
      setOpacity(e, frames[i])
      i += 1
      if (i < frames.length) return
      stopFade(e)
      done?.()
    }, 16)
  }

  return {
    arm(owner) {
      const token = deps.token()
      armed.set(owner.webContents.id, { token, at: deps.now() })
      return `${PREVIEW_FRAME}:${token}`
    },
    options(owner, url, frameName) {
      const token = previewToken(frameName)
      const mine = armed.get(owner.webContents.id)
      if (!token || !mine || mine.token !== token) return null
      armed.delete(owner.webContents.id)
      if (deps.now() - mine.at > PREVIEW_ARM_MS || (url !== 'about:blank' && url !== '')) return null
      // One at a time: a second opens in place of the first.
      kill(owner)
      const from = owner.getBounds()
      const b = previewBounds(from, deps.e2e ? null : deps.workArea(from))
      return {
        ...b,
        show: false,
        frame: false,
        // An owned window: above its owner always, never in the taskbar, and
        // it goes when the owner goes. Not on top of other apps.
        parent: owner,
        skipTaskbar: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        minWidth: PREVIEW_MIN.width,
        minHeight: PREVIEW_MIN.height,
        backgroundColor: deps.ground(),
        opacity: 0,
        title: 'Preview',
        ...(deps.e2e ? { focusable: false } : {})
      }
    },
    adopt(owner, child, frameName) {
      if (!previewToken(frameName)) return
      const entry: Entry<W> = { child, fade: null, closing: false, opacity: 0 }
      open.set(owner, entry)
      setOpacity(entry, 0)
      log('preview-window', { ev: 'open', owner: owner.id })
      child.once('closed', () => {
        const e = open.get(owner)
        if (e?.child !== child) return
        stopFade(e)
        open.delete(owner)
        // Alt+F4 on the window itself: the page still thinks it is open.
        if (!e.closing && !owner.isDestroyed()) deps.closedByItself(owner)
      })
    },
    show(owner, animate) {
      const e = open.get(owner)
      if (!e || e.closing || e.child.isDestroyed()) return
      if (!e.child.isVisible()) e.child.showInactive()
      fade(e, 1, animate)
    },
    close(owner, animate) {
      const e = open.get(owner)
      if (!e || e.closing) return
      e.closing = true
      if (e.child.isDestroyed() || !e.child.isVisible()) return kill(owner)
      fade(e, 0, animate, () => kill(owner))
      log('preview-window', { ev: 'close', owner: owner.id, animate })
    },
    ownerGone(owner) {
      armed.delete(owner.webContents.id)
      kill(owner)
    },
    destroyAll() {
      for (const owner of [...open.keys()]) kill(owner)
      armed.clear()
    },
    of(owner) {
      const e = open.get(owner)
      return e && !e.child.isDestroyed() ? e.child : undefined
    },
    e2e() {
      return [...open].map(([owner, e]) => ({
        owner: owner.id,
        visible: !e.child.isDestroyed() && e.child.isVisible(),
        bounds: e.child.isDestroyed() ? { x: 0, y: 0, width: 0, height: 0 } : e.child.getBounds(),
        opacity: e.opacity,
        fades: fades.get(e.child) ?? []
      }))
    },
    e2eFades: () => [...past]
  }
}
