import { performance } from 'perf_hooks'
import { CH, DCH } from '../shared/channels'
import type { DiagLog } from './diagLog'
import { errorFields, summariseArgs } from './diagSummary'

/**
 * EVERY IPC CALL, TIMED AT THE ONE PLACE THEY ALL PASS (#140).
 *
 * Both apps register every channel on Electron's one `ipcMain` object, and the
 * core's register functions are handed that same object, so patching its
 * `handle`, `on` and `once` here times every call in the app without touching
 * a single registration. Cost per call: two `performance.now()` and a map
 * entry for the in-flight table.
 *
 * - A `handle` that settles after 500 ms, or a sync `on` body that ran 100 ms
 *   or more, is `ipc-slow` with its channel, time and summarised arguments.
 * - One that throws or rejects is `ipc-error`; the error is RETHROWN
 *   UNCHANGED, so behaviour is exactly what it was.
 * - In verbose every call is `ipc` with its channel and time (no arguments).
 * - `removeListener` / `off` with the ORIGINAL listener still remove it
 *   (Prism's `open:listen` depends on that): a map from each listener to its
 *   wrappers, per channel.
 * - `inflight()` is the table of calls running now, which `main-lag` prints:
 *   a late event loop next to a 3 s `folder:sizes` call names the suspect.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Listener = (event: any, ...args: any[]) => any
export interface IpcMainPatchable {
  handle(channel: string, listener: Listener): unknown
  on(channel: string, listener: Listener): unknown
  once?(channel: string, listener: Listener): unknown
  removeListener(channel: string, listener: Listener): unknown
  off?(channel: string, listener: Listener): unknown
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface InflightCall {
  ch: string
  ms: number
  /** It had ended by the time it was asked about, inside the window. */
  done?: true
}

export interface IpcTiming {
  /**
   * Calls running now, and those that ENDED in the last `windowMs`, longest
   * first, at most eight. The window is the point: a lag is only seen once
   * the loop is free again, and by then the call that blocked it has
   * usually settled (MEASURED, the first launch of the built app: a 1630 ms
   * `main-lag` with nothing in flight, beside a 1837 ms `term:spawn` that
   * had ended a millisecond before).
   */
  inflight(windowMs?: number): InflightCall[]
}

export interface IpcTimingOptions {
  now?: () => number
  /** A handle slower than this is `ipc-slow`. */
  slowMs?: number
  /** A sync `on` body slower than this is `ipc-slow`. */
  syncSlowMs?: number
  /** A channel whose arguments are logged by size only. */
  opaque?: (ch: string) => boolean
  /** The host's own channels that wait on the user or a download, added to
   *  `LONG_WAIT` (PT: the folder picker, the update install). */
  longWait?: Iterable<string>
}

/**
 * Calls that are SUPPOSED to take long (review of #140): a folder picker
 * answers when the user has picked, a download when 643 MB have come. They
 * are never `ipc-slow`, which `npm run diag` reads as a stall suspect, and
 * never in `inflight`, where one running for minutes sat at the top of every
 * `main-lag` and pushed the real suspect out of the eight slots. They are
 * still `ipc-error` when they fail, and `ipc` in Detailed logging.
 */
export const LONG_WAIT: ReadonlySet<string> = new Set([DCH.download])

/** Typed text, the clipboard and recorded audio: never written down, even
 *  when the call that carried them was slow. */
const OPAQUE = new Set<string>([CH.input, CH.clipboardWrite, CH.clipboardTerm, DCH.transcribe])
const isOwn = (ch: string): boolean => ch.startsWith('diag:')
const RECENT_MAX = 32

export function timeIpcMain(ipcMain: IpcMainPatchable, log: DiagLog, opts: IpcTimingOptions = {}): IpcTiming {
  const now = opts.now ?? ((): number => performance.now())
  const slowMs = opts.slowMs ?? 500
  const syncSlowMs = opts.syncSlowMs ?? 100
  const opaque = opts.opaque ?? ((ch: string): boolean => OPAQUE.has(ch))
  const longWait = new Set<string>([...LONG_WAIT, ...(opts.longWait ?? [])])

  let nextId = 0
  const running = new Map<number, { ch: string; start: number }>()
  /** The last calls to end, for `inflight`'s window. */
  const recent: Array<{ ch: string; start: number; end: number }> = []
  const wrappers = new WeakMap<Listener, Map<string, Listener[]>>()

  const remember = (fn: Listener, ch: string, w: Listener): void => {
    let byCh = wrappers.get(fn)
    if (!byCh) wrappers.set(fn, (byCh = new Map()))
    const list = byCh.get(ch) ?? []
    list.push(w)
    byCh.set(ch, list)
  }
  const recall = (fn: Listener, ch: string): Listener => {
    const list = wrappers.get(fn)?.get(ch)
    return list?.pop() ?? fn
  }

  const ended = (ch: string, start: number, args: unknown[], ok: boolean, sync: boolean, err?: unknown): void => {
    try {
      const end = now()
      const ms = Math.round(end - start)
      const long = longWait.has(ch)
      if (!long) {
        recent.push({ ch, start, end })
        if (recent.length > RECENT_MAX) recent.shift()
      }
      if (!ok) log.write('main', 'ipc-error', { ch, ms, ...renameMsg(errorFields(err)) })
      if (!long && ms >= (sync ? syncSlowMs : slowMs))
        log.write('main', 'ipc-slow', { ch, ms, args: summariseArgs(args, opaque(ch)), ok, ...(sync ? { sync: true } : {}) })
      else if (log.verbose()) log.write('main', 'ipc', { ch, ms })
    } catch {
      /* the log never breaks a call */
    }
  }

  const wrapHandle = (ch: string, fn: Listener): Listener => {
    if (isOwn(ch)) return fn
    return (event, ...args) => {
      const start = now()
      const id = nextId++
      if (!longWait.has(ch)) running.set(id, { ch, start })
      let result: unknown
      try {
        result = fn(event, ...args)
      } catch (err) {
        running.delete(id)
        ended(ch, start, args, false, false, err)
        throw err
      }
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        return (result as Promise<unknown>).then(
          (v) => {
            running.delete(id)
            ended(ch, start, args, true, false)
            return v
          },
          (err) => {
            running.delete(id)
            ended(ch, start, args, false, false, err)
            throw err
          }
        )
      }
      running.delete(id)
      ended(ch, start, args, true, false)
      return result
    }
  }

  const wrapOn = (ch: string, fn: Listener): Listener => {
    if (isOwn(ch)) return fn
    return (event, ...args) => {
      const start = now()
      let result: unknown
      try {
        result = fn(event, ...args)
      } catch (err) {
        ended(ch, start, args, false, true, err)
        throw err
      }
      ended(ch, start, args, true, true)
      return result
    }
  }

  const orig = {
    handle: ipcMain.handle.bind(ipcMain),
    on: ipcMain.on.bind(ipcMain),
    once: ipcMain.once?.bind(ipcMain),
    removeListener: ipcMain.removeListener.bind(ipcMain),
    off: ipcMain.off?.bind(ipcMain)
  }

  ipcMain.handle = (ch, fn) => orig.handle(ch, wrapHandle(ch, fn))
  ipcMain.on = (ch, fn) => {
    const w = wrapOn(ch, fn)
    if (w !== fn) remember(fn, ch, w)
    orig.on(ch, w)
    return ipcMain
  }
  // NOT through the emitter's own `once`: it registers through `this.on`,
  // which is the patched one, and its inner wrapper is then hidden inside
  // ours where `removeListener(fn)` cannot find it (MEASURED in the unit
  // test). A once is an `on` that removes itself first.
  if (orig.once) {
    ipcMain.once = (ch, fn) => {
      const one: Listener = (event, ...args) => {
        ipcMain.removeListener(ch, fn)
        return fn(event, ...args)
      }
      const w = wrapOn(ch, one)
      remember(fn, ch, w)
      orig.on(ch, w)
      return ipcMain
    }
  }
  ipcMain.removeListener = (ch, fn) => {
    orig.removeListener(ch, recall(fn, ch))
    return ipcMain
  }
  if (orig.off) {
    const off = orig.off
    ipcMain.off = (ch, fn) => {
      off(ch, recall(fn, ch))
      return ipcMain
    }
  }

  return {
    inflight: (windowMs = 0) => {
      const t = now()
      const live: InflightCall[] = [...running.values()].map((r) => ({ ch: r.ch, ms: Math.round(t - r.start) }))
      const settled: InflightCall[] =
        windowMs > 0
          ? recent
              .filter((r) => r.end >= t - windowMs)
              .map((r) => ({ ch: r.ch, ms: Math.round(r.end - r.start), done: true as const }))
          : []
      return [...live, ...settled].sort((a, b) => b.ms - a.ms).slice(0, 8)
    }
  }
}

/** `ipc-error` names the message `err`, beside `ch`. */
function renameMsg(f: { msg: string; stack?: string }): { err: string; stack?: string } {
  return f.stack ? { err: f.msg, stack: f.stack } : { err: f.msg }
}
