import { BrowserWindow, app, dialog } from 'electron'
import { E2E, appState, windows } from './appState'
import { appendCrashLog, crashLine, crashLogSettled } from './crashLog'
import { diagWindowEvent } from './diagWindow'
import { userPaths } from './paths'
import type { QuitReason } from './standby'
import type { Launch } from './startupLog'
import type { createTabsSession } from './tabsSession'
import type { WindowOptions } from './windowOptions'
import type { createWindowPreferences } from './windowPreferences'
import { readWindowState } from './windowChrome'
import { pageGone } from './windowGuard'
import type { WindowSeed } from './windowRegistry'

/** What the recovery needs from index.ts (#538 item 6): the window factory
 *  and the few bits of process state it reads or sets. */
export interface WindowRecoveryDeps {
  createWindow: (options: WindowOptions) => BrowserWindow
  /** The first window of the session has been made (whenReady). */
  firstWindowMade: () => boolean
  /** Records why the process ends; the first reason given stands. */
  quitBecause: (reason: QuitReason) => void
  sessionFile: ReturnType<typeof createTabsSession>['session']
  windowPreferences: ReturnType<typeof createWindowPreferences>
}

/**
 * THE PAGE COMES BACK, AND THE WINDOW IS NEVER LEFT UNSHOWN (#265; owner,
 * 2026-10-03: "prism suddenly stopped opening, not sure why, but that should
 * never happen"). The rules are in windowGuard.ts and crashBudget.ts; this is
 * the crash log and the three ways a window is rebuilt, given up on or made
 * live again.
 */
export function createWindowRecovery(deps: WindowRecoveryDeps): {
  logWindow: (event: string, fields: Record<string, string | number | boolean | undefined>) => void
  recreateWindow: (old: BrowserWindow) => void
  giveUpWindow: () => void
  ensureLivePage: (launch?: Launch) => boolean
  openAsFirst: (opts: { winE?: string; launch?: Launch }) => BrowserWindow
} {
  const { createWindow, sessionFile, windowPreferences } = deps
  const crashLogFile = userPaths.windowCrashes

  function logWindow(
    event: string,
    fields: Record<string, string | number | boolean | undefined>
  ): void {
    void appendCrashLog(crashLogFile(), crashLine(new Date(), event, fields))
    // AND IN THE DIAGNOSTICS LOG (#322): a hang or the watchdog belongs on the
    // same timeline as the stalls and crumbs before it, where `npm run diag`
    // reads it; what the core already writes is not written twice
    // (`diagWindow.ts`). window-crashes.log stays: the error box and the
    // `neverWindowless` e2e name that file.
    diagWindowEvent(event, fields)
  }

  /** A fresh window in place of one whose page keeps dying. The new one is
   *  built FIRST: destroying the only window first would read as the last
   *  window closing, and the app would quit. It comes back with THAT window's
   *  tabs, as its page last reported them (2026-10-29), never the saved strip
   *  of another: a second window that crashes must not come back as a copy of
   *  the first. */
  function recreateWindow(old: BrowserWindow): void {
    const r = windows.recordOf(old)
    const seed: WindowSeed = r?.reported ? { kind: 'tabs', tabs: r.reported } : (r?.seed ?? { kind: 'none' })
    const bounds = old.isDestroyed() ? undefined : old.getNormalBounds()
    const fresh = createWindow({ first: r?.first, seed, launchFlags: r?.launchFlags, bounds, winE: r?.winE })
    if (r) {
      windows.handOver(old, fresh)
      sessionFile.rekey(r.id, fresh.webContents.id)
    }
    if (!old.isDestroyed()) old.destroy()
  }

  /** Nothing left to try: say so (never under --e2e) and end the process, which
   *  frees the single-instance lock for the next launch. An ordinary quit, not
   *  `app.exit`, so `will-quit` still stops the shells and the indexer; the
   *  windows go first, since a dead page has no close question to answer. */
  function giveUpWindow(): void {
    if (!E2E)
      dialog.showErrorBox(
        'Prism',
        `Prism's window stopped working several times in a row, so Prism has closed. Open it again to carry on. Details are in ${crashLogFile()}.`
      )
    appState.appQuitting = true
    deps.quitBecause('gave-up')
    // The crash log is written off main now (2026-10-12): the last lines land
    // before the windows go, since the last window going quits the app.
    void crashLogSettled().finally(() => {
      for (const w of BrowserWindow.getAllWindows()) w.destroy()
      app.quit()
    })
  }

  /**
   * Make sure there is a window with a live page before a second launch's files
   * are handed over (#265). Answers true when it STARTED a page (a new window or
   * a reload), since the files then wait in `pendingOpen` for the page to listen.
   * Raising a window whose page is gone, which is all this used to do, shows a
   * blank frame at best. The window is the one files from outside go to (the
   * one focused last, 2026-10-29); with none left, a new one opens the strip of
   * the window closed last.
   */
  function ensureLivePage(launch?: Launch): boolean {
    if (!app.isReady() || !deps.firstWindowMade()) return false // whenReady makes the window and drains the queue
    if (appState.appQuitting || appState.installingUpdate) return false // a window now would only be taken away
    const target = windows.target()
    if (!target) {
      logWindow('handoff', { window: 'none', action: 'create' })
      openAsFirst({ launch })
      return true
    }
    if (pageGone(target.win)) {
      logWindow('handoff', { window: 'dead', action: 'reload' })
      target.restored = false
      target.win.webContents.reload()
      return true
    }
    return false
  }

  /**
   * A WINDOW AS A COLD START'S FIRST WOULD OPEN (owner, 2026-11-06): with no
   * window left (standby, or a handoff to a windowless Prism), the next one
   * opens where the window closed last was, with its strip ("Reopen tabs at
   * start" off: the Explorer alone), and is the one a Win+E request lands in.
   */
  function openAsFirst(opts: { winE?: string; launch?: Launch }): BrowserWindow {
    const last = sessionFile.primary()
    const remember = windowPreferences.load().values['prism.tabs.remember'] !== 'off'
    // WITHOUT the saved ids (review, 2026-10-29): the last window's close
    // released them for good (releaseDesktop), so the same ids could never
    // be granted their folders again. The restore mints new ones.
    const tabs = last && remember ? last.tabs.map((t) => ({ ...t, id: undefined })) : []
    const win = createWindow({
      first: true,
      seed: tabs.length ? { kind: 'tabs', tabs: { tabs, active: last!.active } } : { kind: 'none' },
      bounds: last?.bounds ? readWindowState(last.bounds) : undefined,
      showNow: !!opts.winE,
      launch: opts.launch
    })
    // The old entry moves to this window; no stale one stays behind (audit #5).
    sessionFile.adopt(win.webContents.id)
    return win
  }

  return { logWindow, recreateWindow, giveUpWindow, ensureLivePage, openAsFirst }
}