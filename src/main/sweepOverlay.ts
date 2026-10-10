import { join } from 'node:path'
import type { BrowserWindow, WebContents } from 'electron'
import {
  SWEEP_CHANNELS,
  parseBegin,
  parseEnd,
  parseUpdate,
  type Rgba,
  type SweepState
} from '@shared/sweepOverlay'
import { SWEEP_ORIGIN, toPhysical, type PhysBox } from './sweepOverlayMath'

/**
 * THE NATIVE SWEEP BOX, MAIN'S HALF (#338; spec
 * docs/superpowers/specs/2026-10-09-native-sweep-overlay-design.md). Main
 * decides, per window, whether the box is drawn natively (the addon in
 * native/sweep, a DirectComposition visual from the real cursor every
 * compositor frame) and tells the page, which keeps today's DOM box until it
 * has heard `true`. It forwards the page's begin / update / end, validated and
 * mapped to physical pixels, and ends the box itself whenever the window
 * stops being where the sweep is (blur, minimise, hide, close, a dead page, a
 * new document).
 *
 * Off, automatically and with no setting, for each reason in `OffReason`;
 * one diagnostics line per change. Nothing here runs on the startup path:
 * `initSweepOverlay` is called after the first window's first paint (#189).
 */

export type OffReason =
  | 'missing'
  | 'load-failed'
  | 'no-clock'
  | 'remote'
  | 'e2e'
  | 'flag'
  | 'target-failed'
  | 'runtime-failure'

/** The addon's surface (native/sweep/sweep.cc). */
export interface PrismSweep {
  probe(): { build: number; clock: boolean; remote: boolean }
  attach(hwnd: Buffer): void
  status(hwnd: Buffer): 'pending' | 'ready' | 'failed' | 'none'
  begin(hwnd: Buffer, box: PhysBox, fill: Rgba, edge: Rgba): boolean
  update(hwnd: Buffer, box: PhysBox): void
  end(hwnd: Buffer): void
  detach(hwnd: Buffer): void
  shutdown(timeoutMs: number): boolean
  stats(): {
    frames: number
    commits: number
    maxWorkUs: number
    failures: number
    sampling?: string
    leadUs?: number
    lateCommits?: number
    widenings?: number
  }
}

export type SweepLoad = { addon: PrismSweep } | { error: 'missing' | 'load-failed'; detail?: string }

export interface SweepOverlay {
  /** Give this window a target, after its first paint. */
  attach(win: BrowserWindow): void
  /** Re-ask what can change while running (Remote Desktop): a display or
   *  session change calls it. */
  recheck(): void
  /** Idempotent: will-quit, then the process's exit. */
  shutdown(): void
  /** Why the native box is off for every window, or null. */
  reason(): OffReason | null
}

export interface SweepOverlayDeps {
  load: () => SweepLoad
  e2e: boolean
  argv: readonly string[]
  log: (fields: Record<string, unknown>) => void
  ipc: { on(channel: string, listener: (e: { sender: WebContents }, msg: unknown) => void): unknown }
  windowOf: (sender: WebContents) => BrowserWindow | null
  setTimeout?: (fn: () => void, ms: number) => unknown
}

/** Where the built addon is: resources\sweep packaged, vendor\sweep in dev. */
export function sweepDirs(packaged: boolean, resourcesPath: string, appPath: string): string[] {
  return packaged ? [join(resourcesPath, 'sweep')] : [join(appPath, 'vendor', 'sweep')]
}

/** A sweep whose thread has not moved this long after its begin is a hung
 *  thread: it would leave its box on the window, so the native box goes off. */
export const WATCHDOG_MS = 500
/** How long a target may stay pending before it counts as failed. */
const ATTACH_WAIT_MS = 3000
const ATTACH_POLL_MS = 25
/** The thread's join at quit; past it the thread is leaked, never destroyed. */
const SHUTDOWN_MS = 250

interface Win {
  win: BrowserWindow
  hwnd: Buffer
  ready: boolean
  /** The live sweep's id, or null. */
  live: number | null
}

/** Under e2e every message is recorded here instead of drawn. */
type Recorded = { kind: string; [k: string]: unknown }

export function initSweepOverlay(deps: SweepOverlayDeps): SweepOverlay {
  const later = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const recorded: Recorded[] | null = deps.e2e ? [] : null
  if (recorded) Object.assign(globalThis, { __e2eSweepOverlay: recorded })

  let addon: PrismSweep | null = null
  let reason: OffReason | null = null
  const say = (fields: Record<string, unknown>): void => deps.log({ a: 'sweep-overlay', ...fields })
  const setReason = (r: OffReason | null, more: Record<string, unknown> = {}): void => {
    if (r === reason) return
    reason = r
    say({ native: r === null, reason: r ?? undefined, ...more })
    broadcast()
  }

  let detail: string | undefined
  if (deps.e2e) reason = 'e2e'
  else if (deps.argv.includes('--sweep-overlay=off')) reason = 'flag'
  else {
    const loaded = deps.load()
    if ('addon' in loaded) {
      addon = loaded.addon
      try {
        const p = addon.probe()
        if (!p.clock) reason = 'no-clock'
        else if (p.remote) reason = 'remote'
      } catch (err) {
        reason = 'load-failed'
        addon = null
        detail = String(err)
      }
    } else {
      reason = loaded.error
      detail = loaded.detail
    }
  }
  say({ native: reason === null, reason: reason ?? undefined, detail })
  /** Reasons that can never clear in this session. */
  const permanent = (): boolean => reason !== null && reason !== 'remote'

  const wins: Win[] = []
  const entryOf = (sender: WebContents): Win | null => {
    const w = deps.windowOf(sender)
    return w ? (wins.find((x) => x.win === w) ?? null) : null
  }
  const nativeFor = (w: Win): boolean => reason === null && w.ready
  const send = (w: Win, state: SweepState): void => {
    if (recorded) recorded.push({ kind: 'state', ...state })
    if (w.win.isDestroyed()) return
    try {
      w.win.webContents.send(SWEEP_CHANNELS.state, state)
    } catch {
      /* the page is going */
    }
  }
  function broadcast(): void {
    for (const w of wins) {
      if (!nativeFor(w) && w.live !== null) endLive(w)
      send(w, { native: nativeFor(w) })
    }
  }

  let shown = false
  let failuresAtStart = 0
  /** Stats at the last line written, so a line is written only when the
   *  sampling changed (the first sweep, a widening, a fall back to the tick). */
  let lastSampling = ''
  const endLive = (w: Win): void => {
    if (w.live === null) return
    w.live = null
    if (!addon) return
    addon.end(w.hwnd)
    const s = addon.stats()
    const sampling = `${s.sampling}:${s.leadUs}:${s.widenings}`
    if (!shown || sampling !== lastSampling) {
      shown = true
      lastSampling = sampling
      say({ sweep: 'end', sampling: s.sampling, leadUs: s.leadUs, lateCommits: s.lateCommits, widenings: s.widenings })
    }
    if (s.failures > failuresAtStart) setReason('runtime-failure', { failures: s.failures })
  }

  const remote = (): boolean => {
    try {
      return !!addon?.probe().remote
    } catch {
      return false
    }
  }
  const recheck = (): void => {
    if (!addon || permanent()) return
    setReason(remote() ? 'remote' : null)
  }

  deps.ipc.on(SWEEP_CHANNELS.begin, (e, raw) => {
    const w = entryOf(e.sender)
    const m = parseBegin(raw)
    if (recorded) recorded.push(m ? { kind: 'begin', ...m } : { kind: 'invalid-begin' })
    if (!w) return
    if (!m) {
      send(w, { native: false })
      return
    }
    if (down || !addon || !nativeFor(w)) return
    if (remote()) {
      setReason('remote')
      return
    }
    if (w.live !== null) endLive(w)
    // Only one box at a time across windows: the addon draws one.
    for (const other of wins) if (other !== w && other.live !== null) endLive(other)
    const before = addon.stats()
    failuresAtStart = before.failures
    if (!addon.begin(w.hwnd, toPhysical(m, SWEEP_ORIGIN), m.fill, m.edge)) {
      say({ sweep: 'begin-refused', status: addon.status(w.hwnd) })
      send(w, { native: false })
      return
    }
    w.live = m.id
    const a = addon
    later(() => {
      if (reason !== null) return
      const s = a.stats()
      if (s.frames === before.frames) setReason('runtime-failure', { hung: true })
      else if (s.failures > before.failures) setReason('runtime-failure', { failures: s.failures })
    }, WATCHDOG_MS)
  })

  deps.ipc.on(SWEEP_CHANNELS.update, (e, raw) => {
    const m = parseUpdate(raw)
    if (recorded) recorded.push(m ? { kind: 'update', ...m } : { kind: 'invalid-update' })
    const w = entryOf(e.sender)
    if (!m || !w || !addon || w.live !== m.id) return
    addon.update(w.hwnd, toPhysical(m, SWEEP_ORIGIN))
  })

  deps.ipc.on(SWEEP_CHANNELS.end, (e, raw) => {
    const m = parseEnd(raw)
    if (recorded) recorded.push(m ? { kind: 'end', ...m } : { kind: 'invalid-end' })
    const w = entryOf(e.sender)
    if (!m || !w || w.live !== m.id) return
    endLive(w)
  })

  const attach = (win: BrowserWindow): void => {
    if (wins.some((x) => x.win === win) || win.isDestroyed()) return
    const w: Win = { win, hwnd: win.getNativeWindowHandle(), ready: false, live: null }
    wins.push(w)
    const stop = (): void => endLive(w)
    // Main ends the box itself, without waiting for the page: the window is
    // no longer where the sweep is.
    win.on('blur', stop)
    win.on('minimize', stop)
    win.on('hide', stop)
    win.on('closed', () => {
      endLive(w)
      addon?.detach(w.hwnd)
      wins.splice(wins.indexOf(w), 1)
    })
    const wc = win.webContents
    // Every load starts from the truth, never from a stale `true`.
    wc.on('did-finish-load', () => send(w, { native: nativeFor(w) }))
    wc.on('render-process-gone', stop)
    wc.on('did-start-navigation', (...args: unknown[]) => {
      // Electron 43 hands the details on the first argument; older builds
      // passed (event, url, isInPlace, isMainFrame).
      const d = args[0] as { isSameDocument?: boolean; isMainFrame?: boolean } | undefined
      const same = d?.isSameDocument ?? (args[2] as boolean | undefined) ?? false
      const main = d?.isMainFrame ?? (args[3] as boolean | undefined) ?? true
      if (!same && main) stop()
    })
    send(w, { native: false })
    if (!addon || permanent()) return
    addon.attach(w.hwnd)
    const a = addon
    let waited = 0
    const poll = (): void => {
      if (win.isDestroyed() || !wins.includes(w)) return
      const s = a.status(w.hwnd)
      if (s === 'ready') {
        w.ready = true
        if (reason === null) say({ native: true, window: wins.indexOf(w) })
        send(w, { native: nativeFor(w) })
        return
      }
      waited += ATTACH_POLL_MS
      if (s === 'pending' && waited < ATTACH_WAIT_MS) {
        later(poll, ATTACH_POLL_MS)
        return
      }
      setReason('target-failed', { status: s })
    }
    later(poll, ATTACH_POLL_MS)
  }

  let down = false
  const shutdown = (): void => {
    if (down) return
    down = true
    for (const w of wins) endLive(w)
    if (!addon) return
    try {
      if (!addon.shutdown(SHUTDOWN_MS)) say({ shutdown: 'timeout' })
    } catch {
      /* quitting: nothing left to report to */
    }
  }

  return { attach, recheck, shutdown, reason: () => reason }
}

/** Loads the addon from the first folder that has it. */
export function loadSweepAddon(dirs: string[], exists: (p: string) => boolean): SweepLoad {
  for (const d of dirs) {
    const p = join(d, 'prism_sweep.node')
    if (!exists(p)) continue
    try {
      const m = { exports: {} as unknown }
      process.dlopen(m as NodeModule, p)
      return { addon: m.exports as PrismSweep }
    } catch (err) {
      return { error: 'load-failed', detail: String(err) }
    }
  }
  return { error: 'missing' }
}
