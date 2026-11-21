import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { performance } from 'perf_hooks'
import { CALL, PUSH } from '@shared/channels'
import type { OpenPayload } from '@shared/types'
import type { Diagnostics } from 'prism-term-core/main/diagnostics'
import { E2E, appState, windows } from './appState'
import { browseDirectory } from './browse'
import { grantDesktopDirectory } from './desktopAccess'
import { crashBudget } from './crashBudget'
import { createExplorerListings } from './explorerListing'
import { tailOwner } from './ipc/files'
import { releaseTab } from './ipc/browse'
import { stopTailsOf } from './fileTail'
import type { MainState } from './mainState'
import { createOpenQueue } from './openQueue'
import { createPreviewWindows } from './previewWindow'
import { createSpareIdle } from './spareIdle'
import { parseTabs, type SavedTabs } from './tabs'
import { createTabsSession } from './tabsSession'
import { createTearOff } from './tearOff'
import { guardWindow } from './windowGuard'
import { shortId, winERequest, winEHostOf, createWinERequests } from './winERequests'
import { createWindowPreferences } from './windowPreferences'
import type { createWindowRecovery } from './windowRecovery'
import { firstWindow } from './windowSize'
import type { WindowSeed } from './windowRegistry'
import type { WindowOptions } from './windowOptions'
import {
  applyDwmBorder,
  applyMaterial,
  raise,
  readWindowState,
  releaseShroud,
  themeGround,
  watchWindowState
} from './windowChrome'

/** After the first frame is on screen, not in the race for it. */
const SWEEP_OVERLAY_DELAY_MS = 400

/** The renderer flags only the cold start's first window gets: setup runs the
 *  guide, the demo its own (they ride in the page's argv). A later window
 *  never inherits them from the process (2026-10-29). */
export function coldStartFlags(): string[] {
  return [
    ...(process.argv.includes('--setup') ? ['--prism-setup'] : []),
    ...(process.argv.includes('--demo') ? ['--prism-demo'] : [])
  ]
}

/** What the window factory needs from index.ts (audit #7 step 2): the parts
 *  main builds before any window, and the process state it reads or sets. */
export interface WindowFactoryDeps {
  state: MainState
  diag: () => Diagnostics | null
  sessionFile: ReturnType<typeof createTabsSession>['session']
  restoreTabs: ReturnType<typeof createTabsSession>['restoreTabs']
  windowPreferences: ReturnType<typeof createWindowPreferences>
  explorerListings: ReturnType<typeof createExplorerListings>
  winERequests: ReturnType<typeof createWinERequests>
  openQueue: ReturnType<typeof createOpenQueue>
  spareIdle: ReturnType<typeof createSpareIdle>
  previewWindows: ReturnType<typeof createPreviewWindows<BrowserWindow>>
  tear: ReturnType<typeof createTearOff<BrowserWindow>>
  windowBudget: ReturnType<typeof crashBudget>
  recovery: Pick<
    ReturnType<typeof createWindowRecovery>,
    'logWindow' | 'recreateWindow' | 'giveUpWindow'
  >
  /** When each pending Win+E request reached this process (ms), for its `shown` line. */
  requestReceived: Map<string, number>
  /** The pages that are playing: a window's close takes its own entry. */
  playing: Set<number>
  holdAwake: (on: boolean) => void
  noteActivity: () => void
  spareSoon: () => void
  replaceSpare: (win: BrowserWindow) => void
  dropSpare: () => void
  sweepOverlayFor: (win: BrowserWindow) => void
  winELine: (ev: string, fields: Record<string, unknown>) => void
  openLink: (url: string) => void
  /** E2E only: a dead page stays dead. */
  holdRecovery: boolean
}

/** The one place a Prism window is made (moved whole out of index.ts). */
export function createWindowFactory(
  d: WindowFactoryDeps
): (options?: WindowOptions) => BrowserWindow {
  const {
    state,
    sessionFile,
    restoreTabs,
    windowPreferences,
    explorerListings,
    winERequests,
    openQueue,
    spareIdle,
    previewWindows,
    tear,
    windowBudget,
    requestReceived,
    playing,
    holdAwake,
    noteActivity,
    spareSoon,
    replaceSpare,
    dropSpare,
    sweepOverlayFor,
    winELine,
    openLink,
    holdRecovery
  } = d
  const { logWindow, recreateWindow, giveUpWindow } = d.recovery
  const { drainPending } = openQueue
  /** Windows made so far: each window's key (`w1`, `w2`, ...), the prefix of
   *  the tab ids its page mints. */
  let windowSerial = 0
  /** The first restore of this process has happened ("Remember tabs" applies to it alone). */
  let coldRestoreDone = false
  let crashedAtStart = false
  /** A tab id main makes (a restored tab without one, the home Explorer) is
   *  unique in the process: two windows can restore in the same millisecond. */
  let mintSeq = 0
  const mintTabId = (prefix: string): string => `${prefix}-${(mintSeq += 1)}-${Date.now()}`

  /** Where a window that is not the first opens: the size of the one focused
   *  last, a step down and right of it, else Prism's first-run size. */
  function nextWindowBounds(): { x?: number; y?: number; width: number; height: number } {
    const from = windows.target()?.win
    if (from && !from.isDestroyed()) {
      const b = from.getNormalBounds()
      return { x: b.x + 32, y: b.y + 32, width: b.width, height: b.height }
    }
    return firstWindow(screen.getPrimaryDisplay().workArea)
  }

  function createWindow(options: WindowOptions = {}): BrowserWindow {
    const first = !!options.first
    const launchFlags = [...(options.launchFlags ?? [])]
    const place =
      options.bounds ??
      (options.saved !== undefined
        ? readWindowState(options.saved?.bounds ?? null)
        : nextWindowBounds())
    const key = `w${(windowSerial += 1)}`
    noteActivity()
    const made0 = performance.now()
    const win = new BrowserWindow({
      title: 'Prism',
      width: place.width,
      height: place.height,
      x: place.x,
      y: place.y,
      minWidth: 560,
      minHeight: 400,
      show: false,
      // Every window under --e2e, whoever made it (2026-10-29): offscreen and
      // unfocusable, never placed from a cursor or a saved size.
      ...(E2E ? { x: -4000, y: -4000, focusable: false, skipTaskbar: true } : {}),
      // Not `frame: false`: DWM refuses to composite acrylic or mica behind a
      // frameless window, which is why a translucent style came out as a hole in
      // the screen. 'hidden' drops the caption but keeps the frame DWM needs, and
      // the custom title bar still draws over it.
      titleBarStyle: 'hidden',
      // Explicit, rather than inherited from the executable: Windows caches the
      // exe's icon per path, so a new build can keep showing the old one in the
      // taskbar. A window icon set here is not cached by anything.
      icon: app.isPackaged
        ? join(process.resourcesPath, 'icon.ico')
        : join(__dirname, '../../build/icon.ico'),
      // The theme's own ground (step 3): the spare must never flash another.
      backgroundColor: themeGround(),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        /* Never throttled (2026-08-27). Chromium takes a window nobody can see
         * down to about a frame a second, and with it goes the media: a film
         * paused the instant another window covered Prism. It was right for a
         * viewer sitting idle in the background and wrong for one that is
         * playing, and Prism cannot tell the difference cheaply enough to be
         * worth the surprise. (The recorder needed this too - a throttled
         * window films as a slideshow.) */
        backgroundThrottling: false,
        // Setup launches Prism with --setup so the guide runs even on a machine
        // that has seen it before. It rides in the renderer's own argv rather
        // than an IPC message, so it is there before the first render. The
        // first window's only (`coldStartFlags`).
        additionalArguments: [
          ...launchFlags,
          // The window's key: the prefix of every tab id its page mints, so
          // ids are unique across windows (2026-10-29, sessionIds.ts).
          `--prism-window=${key}`,
          // The page's clipboard is main's in-memory one under --e2e (#356);
          // the preload learns it here, since the renderer's argv is its own.
          ...(E2E ? ['--prism-e2e'] : [])
        ]
      }
    })
    const rec = windows.add(win, {
      key,
      first,
      seed: options.seed ?? { kind: 'none' },
      launchFlags,
      winE: options.winE,
      spare: options.spare
    })
    const page = rec.id
    const launch = options.launch
    launch?.mark('made')
    // How long the constructor itself took: the spare's froze for 9 minutes
    // on 2026-11-01 (the audit). Said when it is slow, for any window.
    const makeMs = Math.round(performance.now() - made0)
    if (makeMs >= 1000)
      d.diag()?.log.write('main', 'window-make-slow', {
        ms: makeMs,
        win: key,
        spare: !!options.spare
      })
    // Anything the user does in any window holds the spare back (spareIdle.ts).
    win.webContents.on('input-event', noteActivity)
    win.webContents.on('ipc-message', (_e, channel) => {
      if (!String(channel).startsWith('diag:')) noteActivity()
    })
    /** The Win+E requests this window's page answers, if any (`winEHostOf`). */
    const winEHost = winEHostOf(rec)
    state.firstWindowMade = true
    // The cold start's first window carries the saved entry until its page
    // reports a strip of its own (session.ts `seed`).
    if (options.saved) sessionFile.seed(page, options.saved)
    // A Win+E window never outranks an ordinary one at the next cold start
    // (session.ts, review 2026-10-29); its crash rebuild keeps the rank.
    if (options.winE) sessionFile.minor(page)
    // A window that is not the first is parked the moment it exists under
    // --e2e, so nothing it shows can be seen (the harness parks every window).
    if (E2E && !first) win.setOpacity(0)
    // The diagnostics log's watch (#322): this window's hang events, and its
    // frame for the page's stack when ITS heartbeat stops (each page beats on
    // its own, 2026-10-29). A rebuilt window (#265) is handed over the same way.
    d.diag()?.watchWindow(win)
    // Windows is shutting down or logging off: no will-quit is coming, so the
    // log's last lines (those just before a hang at shutdown) are written here,
    // once however many windows hear it.
    win.on('session-end', () => {
      if (state.sessionEnded) return
      state.sessionEnded = true
      state.quitReason ??= 'session-end'
      d.diag()?.log.write('main', 'session-end', {})
      d.diag()?.log.flushSync() // sync-ok: shutdown, the process may be killed right after session-end
    })
    let shown = false
    const showWindow = (): void => {
      if (shown || win.isDestroyed()) return
      shown = true
      // Never reopened maximised (owner, 2026-10-11): see windowSize.ts.
      if (E2E) win.showInactive()
      else raise(win, 'show')
      launch?.mark('shown')
      // A Win+E's window on screen: how long since its press reached Prism.
      const req = rec.winE ?? (first ? state.hotkeyOpening?.id : undefined)
      const got = req ? requestReceived.get(req) : undefined
      if (req && got !== undefined) {
        requestReceived.delete(req)
        winELine('shown', { id: shortId(req), ms: Date.now() - got, win: key })
      }
      // No helper to warm (#189): the border program is compiled at build time
      // and started per change with no pipe, so this costs milliseconds and the
      // first frame no longer waits ~900 ms behind a PowerShell's stdin pipe.
      applyDwmBorder(win)
    }
    // The spare stays hidden: the tear shows it, inactive, under the cursor.
    const showUnlessSpare = (): void => {
      if (!rec.spare) showWindow()
    }
    win.once('ready-to-show', () => launch?.mark('readyToShow'))
    win.once('ready-to-show', showUnlessSpare)
    win.webContents.once('dom-ready', showUnlessSpare)
    // The native sweep box's target (#338), once this window has painted.
    win.webContents.once('did-finish-load', () =>
      setTimeout(() => sweepOverlayFor(win), SWEEP_OVERLAY_DELAY_MS)
    )
    guardWindow(win, {
      budget: windowBudget,
      log: logWindow,
      show: showUnlessSpare,
      // A spare that keeps dying is simply made again later: it holds nothing.
      recreate: () => (rec.spare ? replaceSpare(win) : recreateWindow(win)),
      giveUp: giveUpWindow,
      // The text the page held died with it; a close must not ask about it.
      // THIS window's flag only (2026-10-29): another window's text is alive.
      stateLost: () => {
        rec.dirty = false
      },
      quitting: () => appState.appQuitting,
      held: () => holdRecovery,
      // The spare is hidden on purpose: no watchdog false alarm (2026-11-06).
      hiddenByDesign: () => rec.spare && !win.isDestroyed() && !win.isVisible()
    })
    // E2E only: the page dies as it commits, before anything has shown the
    // window, which is the shape of the 2026-10-03 failure. Once per process.
    if (E2E && process.env.PRISM_E2E_CRASH_AT_START === '1' && !crashedAtStart) {
      crashedAtStart = true
      win.webContents.once('did-navigate', () => win.webContents.forcefullyCrashRenderer())
    }
    // The border follows maximize state; fullscreen changes call applyDwmBorder
    // themselves on the way out, and applyMaterial's debounce covers the rest.
    win.on('maximize', () => applyDwmBorder(win))
    win.on('unmaximize', () => applyDwmBorder(win))
    // Its bounds go into its own entry of the session file (session.ts).
    watchWindowState(
      win,
      (bounds) => sessionFile.bounds(page, bounds),
      // On main's thread only for the last window or the quit (the window
      // closing is still counted here).
      () =>
        sessionFile.flush(windows.count() <= 1 || appState.appQuitting || appState.installingUpdate)
    )
    // Files from outside go to the window focused last.
    win.on('focus', () => {
      windows.focused(win)
      sessionFile.focus(page)
      // Files queued for a window still restoring when the focus moved here:
      // this one has restored, so they open here now (review, 2026-10-29).
      if (openQueue.waiting() && rec.restored) void drainPending(win)
    })
    /**
     * A WINDOW'S CLOSE LETS GO OF WHAT ITS TABS HELD (2026-10-29). Closing a
     * window's last tab closes the window without a `browseRelease` per tab
     * (useTabOps.ts), which was fine while that close ended the process. With
     * other windows still open, every tab of the closed one would keep its
     * folder grants, its folder watch, its listing's details run and its
     * searches, and its tails and conversions would run on for nobody. So main
     * releases them here, except a tab that is moving to another window
     * (`windows.markMoving`, tab tear-off step 3), and except a window being
     * replaced by its own crash rebuild, whose tabs live on in the new one.
     */
    win.on('closed', () => {
      const rebuilding = rec.rebuilding
      const spare = rec.spare
      // Its preview window is no window of the session's: it goes with it.
      // Never in the way of the rest of this close.
      try {
        previewWindows.ownerGone(win)
      } catch {
        /* already gone */
      }
      if (state.hotkeyOpening?.win === win) state.hotkeyOpening.closed = true
      // A tear in flight from or into this window ends (its tab goes back).
      // FIRST, before the registry forgets the window (review 2026-10-29): the
      // tab stops flying here, so the source's own close below releases it
      // rather than leaving its grants and watch to nobody.
      tear.gone(win)
      const released = windows.remove(win)
      const others = windows.count() > 0
      if (spare) {
        // The spare holds nothing of the session: no entry, nothing to release.
        // Made again later, unless the app is going.
        if (others && !appState.appQuitting) spareSoon()
      } else if (!rebuilding) {
        // The session file: a window closed while others stay open takes its
        // entry with it; the last one keeps it (owner, 2026-10-29).
        // A shutdown or log-off is a quit too: Windows closes the windows one
        // by one with no before-quit, and each would otherwise drop its entry,
        // leaving only whichever closed last (review, 2026-10-29).
        sessionFile.closed(page, {
          others,
          quitting: appState.appQuitting || appState.installingUpdate || state.sessionEnded
        })
        for (const tabId of released) releaseTab(tabId)
        // Its Win+E state goes with it (a crash rebuild's window keeps it).
        if (winEHost) winERequests.forget(winEHost)
      }
      // Tails are keyed by the PAGE, not the tab: a crash rebuild's new page
      // has a new id and starts its own, so the old page's stop here too
      // (review, 2026-10-29), or each crash left a poller reading for nobody.
      stopTailsOf(tailOwner({ id: page }))
      if (playing.delete(page)) holdAwake(playing.size > 0)
      // THE SHROUD NEVER KEEPS THE APP ALIVE: the last page window gone, the
      // hidden fullscreen cover goes too, so `window-all-closed` can come. And
      // so does the tear-off's spare (step 3): a hidden window must never keep
      // Prism running with nothing on screen.
      if (!others) {
        releaseShroud()
        dropSpare()
      }
      // Files that were waiting for this window go to the one now in front,
      // once it has restored.
      else if (openQueue.waiting() && windows.target()?.restored)
        void drainPending(windows.target()!.win)
    })
    /**
     * Minimised, and focused, told to the page (2026-08-26).
     *
     * The renderer cannot see either: Electron does not mark a MINIMISED window
     * hidden, so `visibilitychange` never fires and `document.hidden` stays
     * false, and window blur in the page is not the same question as "another
     * application has the focus". The player's "pause in the background" setting
     * needs both, so main - which does know - says so. THIS window's state, to
     * this window's page (2026-10-29).
     */
    const sayState = (): void => {
      if (win.isDestroyed()) return
      windows.sendTo(win, PUSH.windowState, {
        minimised: win.isMinimized(),
        // Its preview window having the keyboard is still this window being
        // looked at (review 2026-11-08): a click on the preview's player must
        // not count as "in the background" and pause it.
        focused: win.isFocused() || !!previewWindows.of(win)?.isFocused()
      })
    }
    // With a preview window up, the focus moving between the two is a blur
    // here and a focus there, one after the other: said once both are in.
    const sayStateSettled = (): void => {
      if (previewWindows.of(win)) setTimeout(sayState, 50)
      else sayState()
    }
    // Listed one by one: BrowserWindow's overloads are per event name, so a loop
    // over a union of them has no single signature to match.
    win.on('minimize', sayState)
    win.on('restore', sayState)
    win.on('show', sayState)
    win.on('hide', sayState)
    win.on('focus', sayState)
    win.on('blur', sayStateSettled)

    win.on('enter-full-screen', () => {
      windows.sendTo(win, PUSH.windowFullscreen, true)
      applyMaterial(win, true)
    })
    win.on('leave-full-screen', () => {
      windows.sendTo(win, PUSH.windowFullscreen, false)
      applyMaterial(win, false)
    })
    /**
     * A window the page tried to open. Denied, and handed to the OS only when
     * it is a web address (2026-08-31).
     *
     * There was no scheme check here at all, which made any `<a target=_blank>`
     * or `window.open` in the renderer a one-click launch of an arbitrary URI
     * scheme on the user's machine. The renderer shows documents from anywhere
     * - a PDF, a markdown file, a zip member - so "the page asked for it" is
     * not a reason to trust it. Same test as the `shell:external` handler, and
     * for the same reason.
     */
    win.webContents.setWindowOpenHandler((d) => {
      // The preview window (owner, 2026-11-08): the one name this page armed
      // a moment ago, a blank page the Explorer draws into. Nothing else.
      const preview = previewWindows.options(win, d.url, d.frameName)
      if (preview) return { action: 'allow', overrideBrowserWindowOptions: preview }
      if (/^https?:\/\//i.test(d.url)) openLink(d.url)
      return { action: 'deny' }
    })
    win.webContents.on('did-create-window', (child, d) => {
      child.setMenu(null)
      child.on('focus', sayStateSettled)
      child.on('blur', sayStateSettled)
      // The same walls as its owner's page (review 2026-11-08): a middle-click
      // or a drop in the preview window reaches the CHILD's webContents, which
      // would otherwise open any window and load any page (a web page with the
      // inherited preload). It opens nothing and goes nowhere; a web address
      // goes to the browser.
      child.webContents.setWindowOpenHandler((c) => {
        if (/^https?:\/\//i.test(c.url)) openLink(c.url)
        return { action: 'deny' }
      })
      child.webContents.on('will-navigate', (e, url) => {
        e.preventDefault()
        if (/^https?:\/\//i.test(url)) openLink(url)
      })
      previewWindows.adopt(win, child, d.frameName)
    })
    // Its preview window goes with the page that draws it.
    win.webContents.on('render-process-gone', () => previewWindows.ownerGone(win))
    // A page cannot navigate the window away from the app either: the renderer
    // is Prism's own UI and nothing in it is a browser.
    win.webContents.on('will-navigate', (e, url) => {
      const dev = process.env['ELECTRON_RENDERER_URL']
      if (dev && url.startsWith(dev)) return
      if (url.startsWith('file://')) return
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) openLink(url)
    })

    win.webContents.on('did-start-loading', () => {
      rec.restoreStarted = false
      rec.restored = false
      // Its strip comes back when the new page reports it.
      rec.strip = null
      // This window's Win+E requests wait for its new page (a cold start's
      // lands in the first window, one while Prism runs in its own).
      if (winEHost) winERequests.reload(winEHost)
    })
    // The page itself, not a frame inside it: a document preview's iframe
    // loading is no reason to abandon a restore.
    win.webContents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      rec.gen += 1
      previewWindows.ownerGone(win)
      // A source page reloading mid-tear can no longer end it (step 3): the
      // page itself only, a preview's iframe loading ends nothing.
      tear.lost(win)
    })
    // A shortcut press needs an immediate window even on a cold renderer load.
    // Its solid background is followed by the lightweight opening screen. The
    // first window's from the process's argv (a later window never reads it),
    // a window opened for a request while Prism runs from that request.
    if ((first && winERequest(process.argv)) || rec.winE || options.showNow) showWindow()
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) void win.loadURL(devUrl)
    else void win.loadFile(join(__dirname, '../renderer/index.html'))

    // Rebuild last session's strip, then deliver whatever the app was launched
    // with. Order matters: the launch file goes through the same arriving-file
    // rule as everything else, so double-clicking a photo in a folder that was
    // already open lands in that tab rather than opening a second copy of it.
    // The lightweight loading shell can finish its document before App loads.
    // Start restore only once the renderer is actually listening for its files.
    const restoreWhenListening = (event: Electron.IpcMainEvent): void => {
      // THIS window's page only (2026-10-29): every window has its own listener.
      if (event.sender.id !== page || win.isDestroyed()) return
      if (rec.restoreStarted) {
        if (rec.restored) event.sender.send(PUSH.openRestored)
        return
      }
      rec.restoreStarted = true
      // THE SPARE'S PAGE (step 3): nothing to restore, not even the home
      // Explorer, and no file from outside is ever drained into it. It is ready
      // as soon as it listens; a tab torn off is handed to it then. Asked of
      // `spare`, not of `reported`: a drop only commits (and reports) once this
      // page has drawn the tab (review 2026-10-29).
      if (rec.spare && rec.seed.kind === 'adopt') {
        rec.restored = true
        event.sender.send(PUSH.openRestored)
        spareIdle.ready()
        tear.listening(win)
        return
      }
      const gen = rec.gen
      const stale = (): boolean => gen !== rec.gen || win.isDestroyed()
      // SEQUENTIAL, and that is the whole point of the IIFE (2026-08-31). These
      // became async when listDir did, and firing them off together would let
      // the launch file race the restored tabs: the arriving-file rule folds a
      // file into a tab whose root already holds it, so a launch file that
      // arrives BEFORE its own restored tab spawns a duplicate instead.
      void (async () => {
        // WHERE THIS PAGE'S TABS COME FROM (2026-10-29): the strip it reported
        // last (a reload, a crash), else what the window was made with. Only
        // the cold start's first window is made with the saved strip, so no
        // other window can ever restore a copy of it.
        const seed: WindowSeed = rec.reported ? { kind: 'tabs', tabs: rec.reported } : rec.seed
        // "Remember tabs" (owner, 2026-09-22), off: a COLD start opens only the
        // Explorer tab and what Prism was opened with. Once per process, so a
        // reload of the window in the same session still gets its tabs back; the
        // tabs are saved either way.
        const remember = windowPreferences.load().values['prism.tabs.remember'] !== 'off'
        const skip = seed.kind === 'saved' && !remember && !coldRestoreDone
        if (seed.kind === 'saved') coldRestoreDone = true
        // A page back from more than one death in a row comes back without its
        // saved tabs (#265, review): one of them may be what kills it, and
        // restoring it at every recovery ends in the give-up, then the same
        // give-up at every later launch. The Explorer tab and the files handed
        // over still arrive; the log says the tabs were left out.
        const strained = windowBudget.strained(Date.now())
        if (strained && seed.kind !== 'none' && !skip)
          logWindow('restore', { tabs: 'skipped', reason: 'repeated-deaths' })
        const send = (payload: OpenPayload): void => {
          if (stale()) return
          windows.sendTo(win, PUSH.openFile, payload)
          // The first folder this launch's window lists (startupLog.ts).
          if (payload.listing) launch?.mark('listed')
        }
        // The strip, filtered (`parseTabs`: a root that has gone takes its tab).
        const strip = (): SavedTabs | null => {
          if (skip || strained) return null
          if (seed.kind === 'saved') return state.sessionRaw ? parseTabs(state.sessionRaw) : null
          if (seed.kind === 'tabs') return parseTabs(JSON.stringify(seed.tabs))
          return null
        }
        const saved = strip()
        // The home Explorer first when no pinned one was saved (#271): it is
        // the tab the window opens on, and a names-only read is 1 to 3 ms.
        const sendHome = async (): Promise<void> => {
          const id = mintTabId('explorer-home')
          const homePath = app.getPath('home')
          const home =
            (await explorerListings.cachedAsync(homePath)) ??
            (await browseDirectory(id, homePath, 'names'))
          if (stale()) return
          if (home) {
            grantDesktopDirectory(id, home.path)
            send({
              root: home.path,
              files: home.listing.files,
              index: -1,
              role: 'explorer',
              pinned: true,
              restore: true,
              restoreTabId: id,
              listing: { path: home.path, listing: home.listing }
            } satisfies OpenPayload)
          }
        }
        const pinnedSaved = !!saved?.tabs.some((t) => t.role === 'explorer' && t.pinned)
        if (!pinnedSaved) await sendHome()
        if (stale()) return
        const pinnedSent = saved
          ? await restoreTabs(send, saved, (i) => mintTabId(`restored-${i}`))
          : false
        if (stale()) return
        // A saved pinned Explorer whose folder has gone: the home one stands in.
        if (pinnedSaved && !pinnedSent) await sendHome()
        if (stale()) return
        // In argv order, each through the ordinary arriving-file route, so
        // several files from one folder still fold into ONE tab and the last
        // named ends up in front - the one a "prism a.jpg b.jpg" reader means.
        // New OS opens can arrive while a slow restore is still draining. Shift
        // the shared queue so those requests are preserved in arrival order too.
        // Only the window they go to drains it (the one focused last).
        await drainPending(win, () => !stale())
        if (stale()) return
        if (winEHost) winERequests.restored(winEHost)
      })()
        .catch((error: unknown) => console.error('Could not restore the startup session:', error))
        .finally(() => {
          if (stale()) return
          rec.restored = true
          launch?.mark('restored')
          // Startup is over once a first window has restored: the spare may be
          // made at the next quiet spell from now on (spareIdle.ts).
          if (first) {
            state.startupSettled = true
            spareSoon()
          }
          // A handoff's paths are stat'ed awaited (2026-10-12), so one can land
          // in the queue just after the drain above ended: it opens now.
          if (openQueue.waiting()) void drainPending(win, () => !stale())
          // A genuinely empty or failed restore may show the ordinary empty state.
          // Until this signal, no tabs means the initial folders are still loading.
          if (!event.sender.isDestroyed()) event.sender.send(PUSH.openRestored)
        })
    }
    ipcMain.on(CALL.openListen, restoreWhenListening)
    win.once('closed', () => ipcMain.removeListener(CALL.openListen, restoreWhenListening))
    return win
  }

  return createWindow
}
