import { app, BrowserWindow } from 'electron'
import type { Diagnostics } from 'prism-term-core/main/diagnostics'
import { previewUpdate, wantsPreview } from 'prism-term-core/main/updatePreview'
import pkg from '../../package.json'
import { E2E, appState, windows } from './appState'
import { secondLaunch } from './argv'
import { repeatOf } from './hotkeyRepeat'
import type { MainState } from './mainState'
import type { createOpenQueue } from './openQueue'
import type { createStandby } from './standby'
import type { Launch, createStartupLog } from './startupLog'
import { offerUpdate, updateOffered } from './updateFlow'
import { raise } from './windowChrome'
import type { WindowOptions } from './windowOptions'
import type { createWindowRecovery } from './windowRecovery'
import {
  WIN_E_FIRST,
  browseRequest,
  createWinERequests,
  shortId,
  winERequest
} from './winERequests'

/** What the launch router needs from index.ts (audit #7 step 2). */
export interface LaunchRouterDeps {
  state: MainState
  diag: () => Diagnostics | null
  noteActivity: () => void
  standby: ReturnType<typeof createStandby>
  startup: ReturnType<typeof createStartupLog>
  winERequests: ReturnType<typeof createWinERequests>
  /** When each pending Win+E request reached this process (ms), for its `shown` line. */
  requestReceived: Map<string, number>
  /** The launch (or wake) each Win+E request is timed under (`startupLog.ts`). */
  launchOfRequest: Map<string, Launch>
  winELine: (ev: string, fields: Record<string, unknown>) => void
  openQueue: ReturnType<typeof createOpenQueue>
  recovery: Pick<ReturnType<typeof createWindowRecovery>, 'ensureLivePage' | 'openAsFirst'>
  createWindow: (options?: WindowOptions) => BrowserWindow
}

/**
 * The quit is under way and files were handed over: the next Prism, started
 * once this one has gone, opens them. Never under --e2e.
 */
function relaunchWithPaths(
  argv: string[],
  launch: ReturnType<typeof secondLaunch>,
  hasPaths: boolean
): void {
  if (hasPaths && !E2E) app.relaunch({ execPath: argv[0], args: launch.relaunchArgs() })
}

/**
 * WHERE A LAUNCH HANDED TO THIS PROCESS GOES (moved whole out of index.ts,
 * audit #7 step 2): a second Prism's arguments, or the Win+E helper's request
 * over the hotkey pipe. Returns `onLaunch`.
 */
export function createLaunchRouter(
  d: LaunchRouterDeps
): (argv: string[], workingDirectory: string, via: 'second-instance' | 'pipe') => void {
  const {
    state,
    noteActivity,
    standby,
    startup,
    winERequests,
    requestReceived,
    launchOfRequest,
    winELine,
    openQueue,
    createWindow
  } = d
  const { ensureLivePage, openAsFirst } = d.recovery
  const { sendOpen, drainPending } = openQueue
  /** Second-instance handoffs, read one after another so they keep arrival order. */
  let handoffs: Promise<void> = Promise.resolve()
  /** A repeat press brings forward the window the press before it is opening. */
  function raiseOpening(): void {
    const w = state.hotkeyOpening?.win
    if (!w || w.isDestroyed()) return
    if (E2E) w.showInactive()
    else raise(w, 'repeat')
  }
  /** A Win+E or folder-verb request while Prism runs: a new window for it. */
  function openWinEWindow(id: string, browse: string | null): void {
    if (appState.appQuitting || appState.installingUpdate) return
    state.hotkeyOpening = { id, browse, ackedAt: null, closed: false, win: null }
    state.hotkeyOpening.win = createWindow({ seed: { kind: 'none' }, winE: id })
  }
  return (argv: string[], workingDirectory: string, via: 'second-instance' | 'pipe'): void => {
    noteActivity()
    const launch = secondLaunch(argv, workingDirectory)
    const shortcutRequest = winERequest(argv)
    const resting = standby.on()
    d.diag()?.log.write('main', 'second-instance', {
      via,
      ...(shortcutRequest ? { winE: shortId(shortcutRequest) } : {}),
      args: Math.max(0, argv.length - 1),
      ...(resting ? { standby: true } : {})
    })
    if (shortcutRequest) {
      // A window now would only be taken away: no answer, and the helper's
      // own File Explorer fallback opens instead.
      if (appState.installingUpdate || appState.appQuitting) return
      const browse = browseRequest(argv)
      requestReceived.set(shortcutRequest, Date.now())
      winELine('received', {
        id: shortId(shortcutRequest),
        path: resting ? 'standby' : state.firstWindowMade ? 'warm' : 'cold',
        via,
        ...(browse ? { browse: true } : {})
      })
      // A REPEAT PRESS (owner, 2026-11-06): while the window an earlier
      // press asked for is opening, or just after it showed its folder, this
      // one brings THAT window forward and opens nothing.
      const repeat = resting ? null : repeatOf(state.hotkeyOpening, browse, Date.now())
      if (
        repeat === 'follow' &&
        state.hotkeyOpening &&
        winERequests.follow(shortcutRequest, state.hotkeyOpening.id)
      ) {
        requestReceived.delete(shortcutRequest)
        raiseOpening()
        return
      }
      if (repeat === 'raise') {
        requestReceived.delete(shortcutRequest)
        winERequests.answer(shortcutRequest)
        raiseOpening()
        return
      }
      // THE STARTING PROCESS'S FIRST WINDOW takes a request that arrives
      // before it is made, exactly as the cold start's own (the helper of a
      // second press while Prism is still starting).
      if (!state.firstWindowMade) {
        if (winERequests.enqueue(shortcutRequest, WIN_E_FIRST, browse))
          state.hotkeyOpening ??= {
            id: shortcutRequest,
            browse,
            ackedAt: null,
            closed: false,
            win: null
          }
        return
      }
      // A WAKE FROM STANDBY (owner, 2026-11-06): the window opens as the cold
      // start's first would (its strip, its place), shown at once, and the
      // request lands in it. Everything a cold start pays before this point
      // (the process, the modules, the session's set-up) is already done.
      if (resting) {
        // Taken FIRST (review, 2026-11-06): a request refused here opens no
        // window, and woken parts with no window to close would never rest
        // again (window-all-closed cannot fire with none open).
        if (!winERequests.enqueue(shortcutRequest, WIN_E_FIRST, browse)) return
        const wake = startup.begin('standby-wake', {
          winE: true,
          extra: { winE: shortId(shortcutRequest) }
        })
        standby.wake('win-e')
        launchOfRequest.set(shortcutRequest, wake)
        state.hotkeyOpening = {
          id: shortcutRequest,
          browse,
          ackedAt: null,
          closed: false,
          win: null
        }
        state.hotkeyOpening.win = openAsFirst({ winE: shortcutRequest, launch: wake })
        return
      }
      // A NEW WINDOW OF THIS PROCESS (tab tear-off step 2, 2026-10-29; it
      // was a whole second Prism). "started" goes down the helper's pipe at
      // once, and the id once that window's page shows the folder. A token
      // already pending (a retransmission) opens nothing more.
      if (winERequests.enqueue(shortcutRequest, shortcutRequest, browse))
        openWinEWindow(shortcutRequest, browse)
      return
    }
    // `Prism.exe --preview-update` while Prism is already running (it is
    // resident, so it usually is) ends here, not at the launch branch. Only
    // when nothing is on offer: a preview never replaces a real update, nor one
    // that is part way through its install.
    if (wantsPreview(argv) && !updateOffered()) offerUpdate(previewUpdate(pkg.version))
    // A launch that lands while this process is on its way out (#265, review)
    // must not make a window the quit or the installer then takes away with
    // its file. An install starts the new Prism itself; an ordinary quit
    // starts a fresh one with what was handed over, once this one has gone.
    if (appState.installingUpdate) return
    if (appState.appQuitting) {
      // sync-ok: quit, the relaunch must be decided before this process exits
      relaunchWithPaths(argv, launch, launch.pathsNow().length > 0)
      return
    }
    // A new page restores and drains `pendingOpen` itself once it listens
    // (a reload or a new window starts unrestored). From standby, the parts
    // come back first and the wake is timed like a launch.
    if (resting) {
      const wake = startup.begin('standby-wake', { extra: { via: 'launch' } })
      standby.wake('launch')
      ensureLivePage(wake)
    } else ensureLivePage()
    // The handoff is the case the foreground lock bites hardest: Prism has
    // been sitting in the background for an hour, and the file it is handed
    // must arrive in a window that is actually in front of you. Raised FIRST,
    // before the paths are even read, so the foreground-lock fix runs the
    // instant the handoff arrives. The window focused last (2026-10-29).
    const front = windows.target()?.win
    if (front) {
      if (E2E) front.show()
      else raise(front)
    }
    // The paths are stat'ed awaited (owner, 2026-10-12: main never waits on
    // the disk), one handoff after another so they keep arrival order. The
    // opens are sequential for the same reason as the launch drain above:
    // order is what folds them into one tab and leaves the last-named file in
    // front.
    handoffs = handoffs
      .then(async () => {
        const paths = await launch.paths()
        if (appState.installingUpdate) return
        if (appState.appQuitting) {
          relaunchWithPaths(argv, launch, paths.length > 0)
          return
        }
        const to = windows.target()
        if (!to?.restored) openQueue.push(...paths)
        else {
          // Anything still queued goes first, so arrival order holds.
          await drainPending(to.win).catch(() => {})
          // Awaited INSIDE the chain (2026-10-16): fired and forgotten, a
          // later handoff's opens could overtake this one's, and the wrong tab
          // ended up in front. One path that fails still lets the rest open.
          for (const p of paths) await sendOpen(p, to.win).catch(() => {})
        }
      })
      .catch(() => {
        /* a handoff that cannot be read opens nothing */
      })
  }
}
