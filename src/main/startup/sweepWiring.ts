import { existsSync } from 'fs'
import { app, BrowserWindow, ipcMain, powerMonitor, screen } from 'electron'
import { E2E } from '../appState'
import { mainCrumb } from '../diagCrumb'
import {
  initSweepOverlay,
  loadSweepAddon,
  sweepDirs,
  type SweepLoad,
  type SweepOverlay
} from '../sweepOverlay'

/**
 * THE NATIVE SWEEP BOX'S STATE (audit #7 step 2), moved whole out of index.ts:
 * `sweepOverlayFor` starts it once and attaches each window; `loaded` is the
 * addon as the sweep loaded it, for the tab tear-off.
 */
export function createSweepWiring(): {
  sweepOverlayFor: (win: BrowserWindow) => void
  loaded: () => SweepLoad | null
} {
  /**
   * THE NATIVE SWEEP BOX (#338; src/main/sweepOverlay.ts): started lazily, once,
   * after the first window has painted (#189: nothing on the startup path), and
   * every window after that gets its target the same way.
   */
  let sweepOverlay: SweepOverlay | null = null
  /** The addon as the sweep loaded it. The tab tear-off asks it the system's
   *  window order too (`nativeWindows`), but never loads it itself: not on a
   *  drag's path, and not when the sweep is off by flag. */
  let sweepLoaded: SweepLoad | null = null
  function sweepOverlayFor(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    if (!sweepOverlay) {
      sweepOverlay = initSweepOverlay({
        // sync-ok: once, after the first window has painted; loading a native addon is synchronous anyway
        load: () =>
          (sweepLoaded = loadSweepAddon(
            sweepDirs(app.isPackaged, process.resourcesPath, app.getAppPath()),
            existsSync
          )),
        e2e: E2E,
        argv: process.argv,
        log: (fields) => mainCrumb('sweep-overlay', fields),
        ipc: ipcMain,
        windowOf: (sender) => BrowserWindow.fromWebContents(sender)
      })
      // Remote Desktop composes on the client: asked again when a session or
      // the displays change.
      const recheck = (): void => sweepOverlay?.recheck()
      screen.on('display-metrics-changed', recheck)
      screen.on('display-added', recheck)
      powerMonitor.on('unlock-screen', recheck)
      // The thread is joined at will-quit and again (idempotent) at the
      // process's exit, which `app.exit` reaches and will-quit does not.
      app.once('will-quit', () => sweepOverlay?.shutdown())
      process.once('exit', () => sweepOverlay?.shutdown())
    }
    sweepOverlay.attach(win)
  }
  return { sweepOverlayFor, loaded: () => sweepLoaded }
}
