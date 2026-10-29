import { cpus, release, totalmem } from 'os'
import { dirname } from 'path'
import { stat } from 'fs/promises'
import { hookCrashes, watchWindowHealth, type EmitterLike } from './crashHooks'
import { registerDiagIpc } from './diagIpc'
import { createDiagLog, NULL_DIAG_LOG, setDiagMain, type DiagLog } from './diagLog'
import type { IpcMainLike } from './ipcLike'
import { timeIpcMain, type IpcMainPatchable } from './ipcTiming'
import { startStallWatch, type StallWatch } from './stallWatch'
import { startMemWatch, type MemWatch, type ProcessMetricLike } from './memWatch'

/**
 * THE DIAGNOSTICS LOG, WIRED IN ONE CALL (#140). A host calls this in main
 * BEFORE it registers any IPC (the timing wraps `ipcMain` itself, so a
 * channel registered earlier is not timed), then hands over its window once
 * it exists (`watchWindow`) and calls `stop` on the quit path.
 *
 * `diagLogDir` is the contract: `<userData>\logs`. A host that passes none
 * logs nothing at all (no file, no timer, no wrapper), but the page's bridge
 * still answers, so a page built against this core never throws for want of
 * a handler. That is Prism until it wires the folder.
 */

export interface DiagnosticsDeps {
  /** `<userData>\logs`. Absent: nothing is logged. */
  diagLogDir?: string
  ipcMain: IpcMainLike & IpcMainPatchable
  /** Node's `process`. */
  process: EmitterLike
  /** Electron's `app`. */
  app: EmitterLike
  /** For the session line. */
  appInfo: { name: string; version: string; e2e?: boolean }
  /** Show the log folder (Settings' Open folder). */
  openFolder(dir: string): void
  /** The host's channels that wait on the user or a download: never
   *  `ipc-slow`, never in `inflight` (`ipcTiming`'s `LONG_WAIT`). */
  longWaitChannels?: string[]
  /** Electron's `powerMonitor`, as a getter: it cannot be used before the
   *  app is ready, so it is hooked in `watchWindow`. Its `suspend` and
   *  `resume` keep a sleep from being logged as a lag. */
  powerMonitor?: () => EmitterLike
  /** Electron's `app.getAppMetrics`: each process's memory for the `memory`
   *  crumb and `mem-high` (2026-10-16). Absent: no memory readings. */
  appMetrics?: () => ProcessMetricLike[]
  /** Detailed logging until the owner switches it (`DiagLogOptions`). */
  verboseByDefault?: boolean
}

/** The slice of a BrowserWindow the watch needs. */
export interface DiagWindow extends EmitterLike {
  isDestroyed?(): boolean
  /** Minimised: the page beats slower, and the watch waits longer for it. */
  isMinimized?(): boolean
  webContents: { mainFrame?: { collectJavaScriptCallStack?(): Promise<string> | Promise<void> } | null }
}

export interface Diagnostics {
  log: DiagLog
  /** The window's hang events, and its frame for the page stack. */
  watchWindow(win: DiagWindow): void
  /** The quit path: timers stopped, the queue written synchronously. */
  stop(): void
}

export function startDiagnostics(deps: DiagnosticsDeps): Diagnostics {
  if (!deps.diagLogDir) {
    registerDiagIpc({ ipcMain: deps.ipcMain, log: NULL_DIAG_LOG, openFolder: () => {} })
    return { log: NULL_DIAG_LOG, watchWindow: () => {}, stop: () => {} }
  }
  const dir = deps.diagLogDir
  const log = createDiagLog({ dir, verboseByDefault: deps.verboseByDefault })
  setDiagMain(log)

  const cpu = cpus()
  log.write('main', 'session', {
    app: deps.appInfo.name,
    version: deps.appInfo.version,
    electron: process.versions.electron ?? null,
    chrome: process.versions.chrome ?? null,
    windows: release(),
    pid: process.pid,
    verbose: log.verbose(),
    cpus: cpu.length,
    cpu: cpu[0]?.model?.trim() ?? null,
    ramGb: Math.round(totalmem() / 1024 ** 3),
    ...(deps.appInfo.e2e ? { e2e: true } : {})
  })

  const timing = timeIpcMain(deps.ipcMain, log, { longWait: deps.longWaitChannels })
  let win: DiagWindow | null = null
  const watch: StallWatch = startStallWatch({
    log,
    inflight: timing.inflight,
    // userData: local, small, and the folder every other write of the app goes to.
    canary: () => stat(dirname(dir)),
    collectStack: async () => {
      if (!win || win.isDestroyed?.()) return null
      const frame = win.webContents.mainFrame
      const stack = frame?.collectJavaScriptCallStack ? await frame.collectJavaScriptCallStack() : null
      return typeof stack === 'string' ? stack : null
    }
  })
  const metrics = deps.appMetrics
  const mem: MemWatch | null = metrics ? startMemWatch({ log, metrics }) : null
  const unhook = hookCrashes({ log, process: deps.process, app: deps.app })
  registerDiagIpc({ ipcMain: deps.ipcMain, log, watch, openFolder: deps.openFolder })

  let power: EmitterLike | null = null
  const onSuspend = (): void => watch.suspend()
  const onResume = (): void => watch.resume()

  return {
    log,
    watchWindow: (w) => {
      win = w
      watchWindowHealth(w, log, watch)
      // The page slows its beat while minimised (perf review, 2026-10-28,
      // `renderer/lib/diag`); main hears the same events first, so its
      // patience is already longer when the slow beats start.
      const pace = (): void => {
        if (win === w) watch.background(!!w.isMinimized?.())
      }
      w.on('minimize', pace)
      w.on('restore', pace)
      w.on('show', pace)
      // A rebuilt window (#265) replaces this one, minimised or not.
      watch.background(false)
      if (!power && deps.powerMonitor) {
        try {
          power = deps.powerMonitor()
          power.on('suspend', onSuspend)
          power.on('resume', onResume)
        } catch {
          power = null
        }
      }
    },
    stop: () => {
      watch.stop()
      mem?.stop()
      power?.removeListener('suspend', onSuspend)
      power?.removeListener('resume', onResume)
      power = null
      unhook()
      log.write('main', 'quit', {})
      log.close()
      setDiagMain(null)
    }
  }
}
