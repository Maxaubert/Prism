import { performance } from 'perf_hooks'
import type { DiagLog } from './diagLog'
import { errorFields } from './diagSummary'
import { createDiagGate } from '../shared/diagGate'

/**
 * ERRORS AND CRASHES, OBSERVED (#140).
 *
 * Observe only: nothing here changes what the app does when something goes
 * wrong. An uncaught exception is heard on `uncaughtExceptionMonitor`, which
 * Node calls BEFORE its own handling and which does not count as handling it.
 * `unhandledRejection` does count, but Electron's main runs Node in warn
 * mode: MEASURED on Electron 43, an unhandled rejection only printed a
 * warning and the app ran on, with or without a listener, so the listener
 * costs the console warning and nothing else.
 *
 * An exception and a process that went are written to disk AT ONCE
 * (`flushSync`): the process may be about to end, and the 250 ms batch would
 * lose exactly the line that explains why. A rejection goes in the batch.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface EmitterLike {
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface CrashHookDeps {
  log: DiagLog
  /** Node's `process`. */
  process: EmitterLike
  /** Electron's `app`. */
  app: EmitterLike
  /** Monotonic ms, for the repeat gate. */
  now?: () => number
}

/** Hooks the process and the app; returns the function that unhooks them. */
export function hookCrashes({ log, process: proc, app, now = () => performance.now() }: CrashHookDeps): () => void {
  const land = (k: string, fields: Record<string, unknown>): void => {
    try {
      log.write('main', k, fields)
      log.flushSync()
    } catch {
      /* the log never adds a second failure to the first */
    }
  }
  // The same error over and over (a rejection inside a poll) is one line per
  // 10 s with a count, not a line each time (`shared/diagGate`).
  const gate = createDiagGate<Record<string, unknown>>()
  const gated = (k: string, fields: Record<string, unknown>, sync: boolean): void => {
    try {
      const line = gate.offer(k, `${k}|${String(fields.msg)}`, fields, now())
      if (!line) return
      if (sync) land(k, line)
      else log.write('main', k, line)
    } catch {
      /* silent */
    }
  }
  const sweep = setInterval(() => {
    try {
      // `k` rides in the held fields for this; the writer keeps its own `k`
      // and drops a field of that name.
      for (const line of gate.sweep(now())) log.write('main', String(line.k), line)
    } catch {
      /* silent */
    }
  }, 10_000)
  sweep.unref?.()
  const onError = (err: unknown, origin: unknown): void =>
    gated('main-error', { ...errorFields(err), origin: typeof origin === 'string' ? origin : null, k: 'main-error' }, true)
  // NOT written synchronously: a rejection does not end the process
  // (MEASURED, above), and a promise that rejects inside a poll would pay a
  // sync mkdir and append on main's thread every cycle. The batch takes it.
  const onRejection = (reason: unknown): void => gated('main-rejection', { ...errorFields(reason), k: 'main-rejection' }, false)
  const onRenderGone = (_e: unknown, _wc: unknown, d: { reason?: string; exitCode?: number } = {}): void =>
    land('gone', { type: 'renderer', reason: d.reason ?? null, exitCode: d.exitCode ?? null })
  const onChildGone = (_e: unknown, d: { type?: string; reason?: string; exitCode?: number; name?: string } = {}): void =>
    land('gone', { type: d.type ?? null, reason: d.reason ?? null, exitCode: d.exitCode ?? null, name: d.name ?? null })

  proc.on('uncaughtExceptionMonitor', onError)
  proc.on('unhandledRejection', onRejection)
  app.on('render-process-gone', onRenderGone)
  app.on('child-process-gone', onChildGone)
  return () => {
    clearInterval(sweep)
    proc.removeListener('uncaughtExceptionMonitor', onError)
    proc.removeListener('unhandledRejection', onRejection)
    app.removeListener('render-process-gone', onRenderGone)
    app.removeListener('child-process-gone', onChildGone)
  }
}

/**
 * A window's own hang events: `unresponsive` (Chromium's hang monitor gave
 * up waiting on the page), then `responsive` with how long it lasted. The
 * hang is handed to the stall watch, which writes the page's stack for it.
 */
export function watchWindowHealth(
  win: EmitterLike,
  log: DiagLog,
  watch?: { unresponsive(): void },
  now: () => number = () => performance.now()
): void {
  let since: number | null = null
  win.on('unresponsive', () => {
    since = now()
    log.write('main', 'unresponsive', {})
    watch?.unresponsive()
  })
  win.on('responsive', () => {
    log.write('main', 'responsive', since === null ? {} : { ms: Math.round(now() - since) })
    since = null
  })
}
