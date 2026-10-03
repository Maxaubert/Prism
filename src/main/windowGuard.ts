import type { BrowserWindow } from 'electron'
import type { CrashBudget, Recovery } from './crashBudget'

/**
 * A WINDOWLESS PRISM IS NOT A STATE PRISM CAN STAY IN (#265; owner,
 * 2026-10-03: "prism suddenly stopped opening, not sure why, but that should
 * never happen").
 *
 * FOUND: a Prism launched from Explorer with an .mp4 was alive and idle 45
 * minutes later with NO renderer process and NO window. The window is only
 * shown once its page is up (`ready-to-show` / `dom-ready`), nothing listened
 * for the page dying, and the process kept the single-instance lock, so every
 * later double-click handed its file to it and exited. Not reproduced (five
 * launches of the same file got a window), so the fix is for the CLASS: a page
 * that dies is brought back, a window that was never shown is shown, and a
 * second launch can always make a working window (that half is in index.ts).
 */
export interface WindowGuardDeps {
  budget: CrashBudget
  /** One line for the crash log. */
  log: (event: string, fields: Record<string, string | number | boolean | undefined>) => void
  /** Shows the window; safe to call more than once. */
  show: () => void
  /** Build a fresh window to replace this one. */
  recreate: () => void
  /** Nothing left to try: end the process so the lock is free. */
  giveUp: () => void
  /** The page's state went with it (unsaved text, a busy agent): forget the mirror. */
  stateLost: () => void
  /** The app is on its way out; a renderer ending now is not a crash to fix. */
  quitting: () => boolean
  /** E2E only: leave a dead page dead, the state the bug left, so the other
   *  nets (the watchdog, the second launch) can be proved on their own. */
  held?: () => boolean
  now?: () => number
  /** How long a window may go unshown before it is shown anyway. */
  showWithinMs?: number
  /** How long a page may not answer before it is restarted. */
  hangMs?: number
}

/** The page in this window is gone: it crashed, or the window itself is. */
export function pageGone(win: BrowserWindow | null): boolean {
  return !win || win.isDestroyed() || win.webContents.isCrashed()
}

export function guardWindow(win: BrowserWindow, deps: WindowGuardDeps): void {
  const wc = win.webContents
  const now = deps.now ?? Date.now
  const url = (): string => (win.isDestroyed() ? '' : wc.getURL())

  const recover = (action: Recovery): void => {
    if (action === 'reload') wc.reload()
    else if (action === 'recreate') deps.recreate()
    else deps.giveUp()
  }

  wc.on('render-process-gone', (_e, details) => {
    // A window being closed takes its renderer with it; that is not a crash.
    // Checked a tick later, because the renderer can end before the window
    // reports itself destroyed.
    setTimeout(() => {
      if (win.isDestroyed() || deps.quitting()) return
      deps.stateLost()
      const held = deps.held?.() ?? false
      const action = held ? undefined : deps.budget.record(now())
      deps.log('gone', {
        reason: details.reason,
        exitCode: details.exitCode,
        shown: win.isVisible(),
        action: action ?? 'held',
        url: url()
      })
      if (action) recover(action)
    }, 0)
  })

  // A page that stops answering is logged; one that stays that way for
  // `hangMs` is restarted through the same route as a crash. Short hangs are
  // left alone: a huge file can keep the page busy for seconds and come back.
  let hang: NodeJS.Timeout | null = null
  win.on('unresponsive', () => {
    deps.log('unresponsive', { url: url() })
    if (hang || deps.held?.()) return
    hang = setTimeout(() => {
      hang = null
      if (win.isDestroyed()) return
      deps.log('hang', { ms: deps.hangMs ?? 45_000, url: url() })
      wc.forcefullyCrashRenderer()
    }, deps.hangMs ?? 45_000)
  })
  win.on('responsive', () => {
    if (!hang) return
    clearTimeout(hang)
    hang = null
    deps.log('responsive', {})
  })

  // THE WATCHDOG. However the page fares, the window is on screen within
  // `showWithinMs` of being made, and a page found dead then is reloaded: a
  // window you can see and close never holds a launch hostage the way an
  // invisible one did.
  const watchdog = setTimeout(() => {
    if (win.isDestroyed()) return
    const gone = wc.isCrashed()
    if (win.isVisible() && !gone) return
    deps.log('watchdog', { shown: win.isVisible(), gone, url: url() })
    deps.show()
    if (gone) wc.reload()
  }, deps.showWithinMs ?? 8000)

  win.once('closed', () => {
    clearTimeout(watchdog)
    if (hang) clearTimeout(hang)
  })
}
