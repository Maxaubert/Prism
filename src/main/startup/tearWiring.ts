import { BrowserWindow, screen } from 'electron'
import { randomBytes } from 'crypto'
import { PUSH } from '@shared/channels'
import { TEAR } from '@shared/tabTear'
import { E2E, windows } from '../appState'
import { browseWatch } from '../browse'
import { mainCrumb } from '../diagCrumb'
import { createPreviewWindows } from '../previewWindow'
import type { PrismSweep, SweepLoad } from '../sweepOverlay'
import { GHOST_PAGE, ONE_FRAME, createTabGhost } from '../tabGhost'
import type { createTabsSession } from '../tabsSession'
import { createTearOff } from '../tearOff'
import { applyDwmBorder, raise, themeGround } from '../windowChrome'

/** What the tear-off group needs from index.ts (audit #7 step 2). */
export interface TearWiringDeps {
  sessionFile: ReturnType<typeof createTabsSession>['session']
  /** The spare, made now if there is none ready to take. */
  takeSpare: () => BrowserWindow
  spareSoon: () => void
  /** The addon as the sweep loaded it (null until it has). */
  sweepLoaded: () => SweepLoad | null
}

/**
 * TAB TEAR-OFF'S PARTS (audit #7 step 2): the ghost window, the preview
 * window, the system's window order and the tear itself. Moved whole out of
 * index.ts, created in the same order.
 */
export function wireTearOff(d: TearWiringDeps): {
  tabGhost: ReturnType<typeof createTabGhost<BrowserWindow>>
  previewWindows: ReturnType<typeof createPreviewWindows<BrowserWindow>>
  tear: ReturnType<typeof createTearOff<BrowserWindow>>
} {
  const { sessionFile, takeSpare, spareSoon } = d
  /**
   * THE GHOST'S WINDOW (owner, 2026-10-30: "let it just be the tab you're
   * carrying"; src/main/tabGhost.ts): tab-sized, frameless, transparent, never
   * focused, never in the taskbar, never under the pointer, above every app.
   * Its page is a fixed data: page with no script of its own and no preload,
   * sandboxed; it may not navigate or open anything. Under --e2e it is parked
   * and clear like every window.
   */
  const tabGhost = createTabGhost<BrowserWindow>({
    e2e: E2E,
    base: themeGround,
    light: () => themeGround() !== '#111318',
    log: (event, fields) => mainCrumb(event, fields),
    make: (ready, gone) => {
      const w = new BrowserWindow({
        show: false,
        frame: false,
        // Opaque: a transparent window draws nothing with DirectComposition off
        // (owner, 2026-10-30: "right now there's nothing"). See-through by its
        // opacity (TEAR.ghostOpacity).
        backgroundColor: themeGround(),
        width: TEAR.tabWidth + TEAR.ghostPad * 2,
        height: TEAR.tabHeight + TEAR.ghostPad * 2,
        ...(E2E ? { x: -4000, y: -4000 } : {}),
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        roundedCorners: false,
        thickFrame: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          spellcheck: false,
          backgroundThrottling: false,
          devTools: false
        }
      })
      w.setAlwaysOnTop(true, 'screen-saver')
      w.setIgnoreMouseEvents(true)
      w.setMenu(null)
      if (E2E) w.setOpacity(0)
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      w.webContents.on('will-navigate', (e) => e.preventDefault())
      w.webContents.once('did-finish-load', ready)
      w.webContents.on('render-process-gone', () => {
        gone()
        if (!w.isDestroyed()) w.destroy()
      })
      w.once('closed', gone)
      void w.loadURL(GHOST_PAGE).catch(() => {})
      return w
    }
  })
  /**
   * THE PREVIEW WINDOW (owner, 2026-11-08; src/main/previewWindow.ts): the
   * Explorer page's own Quick Look window, owned by the window it came from,
   * faded in and out here. In no registry: it never counts as a window of the
   * session, and it goes with its owner and with standby.
   */
  const previewWindows = createPreviewWindows<BrowserWindow>({
    e2e: E2E,
    ground: themeGround,
    workArea: (b) => screen.getDisplayMatching(b).workArea,
    token: () => randomBytes(16).toString('hex'),
    now: () => Date.now(),
    every: (fn, ms) => setInterval(fn, ms),
    stop: (h) => clearInterval(h as NodeJS.Timeout),
    closedByItself: (owner) => windows.sendTo(owner, PUSH.previewWindowGone),
    log: (event, fields) => mainCrumb(event, fields)
  })
  if (E2E)
    Object.assign(globalThis, {
      __e2ePreviewWindows: () => previewWindows.e2e(),
      __e2ePreviewFades: () => previewWindows.e2eFades(),
      __e2ePreviewOpens: () => previewWindows.e2eOpens()
    })
  /**
   * THE SYSTEM'S WINDOWS, FOR THE TEAR (step 4, review 2026-10-30): which of
   * Prism's windows is really in front, and whether another app's window covers
   * a point, from the native addon (native/sweep/zorder.h). Without it (not
   * loaded yet, an older build, --e2e) the tear falls back to Prism's own order
   * of focus and raises, and cannot see other apps.
   */
  const nativeWindows = (): PrismSweep | null => {
    const loaded = d.sweepLoaded()
    return !E2E && loaded && 'addon' in loaded ? loaded.addon : null
  }
  const hwnds = new WeakMap<BrowserWindow, Buffer>()
  /** A window the tear made clear by the addon, and whether that made it layered. */
  const fadedByAddon = new WeakMap<BrowserWindow, boolean>()
  function hwndOf(win: BrowserWindow): Buffer {
    let h = hwnds.get(win)
    if (!h) hwnds.set(win, (h = win.getNativeWindowHandle()))
    return h
  }
  /** `wins` front to back as the system stacks them (those not on screen, such
   *  as one on another virtual desktop, left out), or null when unknown. */
  function systemOrder(wins: BrowserWindow[]): BrowserWindow[] | null {
    const a = nativeWindows()
    if (!a?.zOrder) return null
    try {
      const order = a.zOrder(wins.map(hwndOf))
      if (!Array.isArray(order)) return null
      return order
        .filter((i) => Number.isInteger(i) && i >= 0 && i < wins.length)
        .map((i) => wins[i])
    } catch {
      return null
    }
  }
  const tear = createTearOff<BrowserWindow>({
    e2e: E2E,
    cursor: () => screen.getCursorScreenPoint(),
    workArea: (p) => screen.getDisplayNearestPoint(p).workArea,
    takeSpare,
    listening: (win) => !!windows.recordOf(win)?.restored,
    adopt: (win, carry) => void windows.sendTo(win, PUSH.tabAdopt, carry),
    moving: (tabId, on) => (on ? windows.markMoving(tabId) : windows.unmarkMoving(tabId)),
    // The drop: the floating window is a window of the session from now on,
    // with the tab it shows as its strip (its page reported it while it was
    // still the spare, which the session ignores).
    // The source's record and entry lose the tab at the same moment, not when
    // its page reports again (review 2026-10-29): until then its close released
    // the moved tab's grants and watch, and the file held the tab twice.
    commit: (win, carry, source) => {
      const r = windows.recordOf(win)
      if (!r) return
      r.spare = false
      const t = carry.tab
      r.reported = {
        // Its one tab is its home (`applyCarry`).
        tabs: [
          {
            id: t.id,
            role: 'explorer',
            pinned: true,
            root: t.root,
            browse: t.browse,
            file: t.files[t.index]?.path
          }
        ],
        active: 0
      }
      sessionFile.report(r.id, r.reported)
      const left = windows.handTab(t.id, source, win)
      const src = windows.recordOf(source)
      if (left && src) sessionFile.report(src.id, left)
    },
    reveal: (win) => {
      if (win.isDestroyed()) return
      if (E2E) win.showInactive()
      else raise(win)
      applyDwmBorder(win)
    },
    // The tab goes back (a drop whose floating page never drew it): the
    // floating page drops it, the window hides as the spare, and whatever it
    // reported or asked for is the source's again.
    release: (win, tabId, source) => {
      if (source && !source.isDestroyed()) windows.noteTabOwner(tabId, source.webContents)
      windows.sendTo(win, PUSH.tabRelease, tabId)
      if (!win.isDestroyed()) win.hide()
      const r = windows.recordOf(win)
      if (r) {
        r.reported = null
        r.dirty = false
        sessionFile.closed(r.id, { others: true, quitting: false })
      }
      // The source kept the tab on screen all through the drag (owner,
      // 2026-10-30): if it is still its front tab, the folder watch the
      // floating page started goes on for it (the floating page's own stop
      // comes after the tab is the source's again and is ignored). Otherwise it
      // stops (review 2026-10-29: a background tab the source never shows kept
      // a watch running for nobody).
      const shown = source && !source.isDestroyed() ? windows.recordOf(source)?.reported : null
      if (shown?.tabs[shown.active]?.id !== tabId) void browseWatch(tabId, null, () => {})
    },
    tell: (source, event) => void windows.sendTo(source, PUSH.tearEvent, event),
    spareSoon: () => spareSoon(),
    // STEP 4: ANY WINDOW'S STRIP TAKES THE TAB (owner, 2026-10-29). The
    // windows that can, front to back: shown, restored, not minimized, not the
    // spare; as the system stacks them (the addon), else the one focused or
    // raised most recently in front, and among windows never focused (the
    // e2e's) the newest, as a new window opens on top.
    windowsFront: () => {
      const wins = windows
        .all()
        .filter(
          (r) =>
            !r.spare &&
            r.restored &&
            !r.win.isDestroyed() &&
            r.win.isVisible() &&
            !r.win.isMinimized()
        )
        .reverse()
        .sort((a, b) => b.frontAt - a.frontAt)
        .map((r) => r.win)
      return systemOrder(wins) ?? wins
    },
    covered: (p, win) => {
      const a = nativeWindows()
      if (!a?.coveredAt || win.isDestroyed()) return false
      try {
        const q = screen.dipToScreenPoint(p)
        return a.coveredAt(q.x, q.y, hwndOf(win)) === true
      } catch {
        return false
      }
    },
    // Only a page that has restored its tabs takes one (review 2026-10-30): a
    // page reloading mid-drag reports its strip as its first tab mounts.
    stripOf: (win) => {
      const r = windows.recordOf(win)
      return r?.restored && !win.isDestroyed() && win.isVisible() && !win.isMinimized()
        ? r.strip
        : null
    },
    name: (win) => windows.recordOf(win)?.key ?? '',
    hover: (win, hover) => void windows.sendTo(win, PUSH.tabHover, hover),
    // The drop into another window's strip: that window has the tab from now on
    // (its record lists it at once, so its close releases it; its page reports
    // the real order next), and the source's record and entry lose it at the
    // same moment, exactly as a tear's commit does.
    merge: (target, carry, source, at) => {
      const r = windows.recordOf(target)
      if (!r) return
      const t = carry.tab
      const left = windows.handTab(t.id, source, target)
      const src = windows.recordOf(source)
      if (left && src) sessionFile.report(src.id, left)
      const tabs = (r.reported?.tabs ?? []).filter((x) => x.id !== t.id)
      const i = Math.max(0, Math.min(at ?? tabs.length, tabs.length))
      tabs.splice(i, 0, {
        id: t.id,
        role: 'explorer',
        root: t.root,
        browse: t.browse,
        file: t.files[t.index]?.path
      })
      r.reported = { tabs, active: i }
      sessionFile.report(r.id, r.reported)
      windows.sendTo(target, PUSH.tabMerge, { carry, at })
    },
    // To the front WITHOUT the focus: the source holds the pointer, and its
    // window losing the focus would cancel the carry.
    raise: (win) => {
      if (!win.isDestroyed()) win.moveTop()
    },
    raised: (win) => windows.raised(win),
    // THE GHOST (owner, 2026-10-30): only the tab follows the cursor; the
    // floating window stays hidden until the drop.
    ghost: tabGhost,
    // At the drop the ghost stays until the window just shown has drawn a frame
    // (review 2026-10-30): hidden all through the drag, it has drawn nothing.
    drawn: (win, fn) => {
      if (win.isDestroyed()) return fn()
      win.webContents.executeJavaScript(ONE_FRAME).then(fn, fn)
    },
    // The only tab's window while a drop restores and moves it (review
    // 2026-10-30: no restore animation to its old place, no frame at the new
    // size before it has drawn). By the addon only: back, it is not layered any
    // more, where Electron's setOpacity leaves it layered for good and a
    // layered window loses its Mica or acrylic. Without it the move just shows.
    fade: (win, out) => {
      const a = nativeWindows()
      if (!a?.setAlpha || !a.unlayer || win.isDestroyed()) return
      try {
        if (out) {
          const added = a.setAlpha(hwndOf(win), 0)
          fadedByAddon.set(win, added || fadedByAddon.get(win) === true)
          return
        }
        if (!fadedByAddon.has(win)) return
        a.setAlpha(hwndOf(win), 255)
        if (fadedByAddon.get(win)) a.unlayer(hwndOf(win))
        fadedByAddon.delete(win)
      } catch {
        // The addon failed: never leave the window clear (layered then, but seen).
        fadedByAddon.delete(win)
        if (!out && !win.isDestroyed()) win.setOpacity(1)
      }
    },
    // Its tab went into another window: nothing is left in it, and its text went
    // with the tab, so it closes asking nothing. After this turn, so the page's
    // answer to its drop goes out first.
    closeEmptied: (win) => {
      const r = windows.recordOf(win)
      if (r) {
        r.closeConfirmed = true
        r.dirty = false
      }
      setTimeout(() => {
        if (!win.isDestroyed()) win.close()
      }, 0)
    },
    log: (event, fields) => mainCrumb(event, fields)
  })
  return { tabGhost, previewWindows, tear }
}
