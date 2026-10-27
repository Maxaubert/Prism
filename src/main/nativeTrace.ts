import { readdir, unlink } from 'fs/promises'
import { join } from 'path'
import type { DiagLog } from 'prism-term-core/main/diagLog'
import { LAG_PROFILE_MIN_MS } from './lagProfiler'

/**
 * A MAIN-LAG CARRIES A CHROMIUM TRACE TOO (owner, 2026-10-27, "keep logging
 * as much as possible"). The startup freeze of 0.119.4 (4 s at 10 s uptime)
 * was caught by the CPU profiler and its profile was 4.6 s of `(idle)`: main's
 * JavaScript was waiting while the thread was blocked in Electron, Chromium or
 * Windows, which a V8 profile cannot see. Chromium's own tracing can: every
 * task the browser's threads run is a `toplevel` event naming where it was
 * posted from, so a 4 s task on CrBrowserMain names its source.
 *
 * Tracing runs from app ready for the whole session into a ring buffer
 * (`record-continuously`, TRACE_BUFFER_KB): nothing is written until a
 * `main-lag` of LAG_PROFILE_MIN_MS or more. Then the buffer is stopped into
 * `lag-<time>.trace.json` in the log folder (open it in https://ui.perfetto.dev
 * or chrome://tracing), the line names it in `trace`, and recording starts
 * again. At most one dump every MIN_GAP_MS, so a burst of lags writes one
 * file; only the newest TRACE_KEEP files are kept. A `lag-trace` line says
 * when a dump failed.
 *
 * Wraps the log's `write` the way lagProfiler.ts does, so the detector (the
 * core's stallWatch) is unchanged.
 */

export const TRACE_BUFFER_KB = 8 * 1024
export const TRACE_KEEP = 5
export const MIN_GAP_MS = 60_000
export const TRACE_CATEGORIES = [
  'toplevel',
  'ipc',
  'mojom',
  'electron',
  'gpu',
  'startup',
  'navigation',
  'loading'
]

/** The slice of Electron's contentTracing used here. */
export interface TracingLike {
  startRecording(options: object): Promise<unknown>
  stopRecording(resultFilePath?: string): Promise<string>
}

export interface NativeTraceDeps {
  log: DiagLog
  tracing: TracingLike
  now?: () => number
  wall?: () => Date
  keep?: number
  minGapMs?: number
}

export interface NativeTrace {
  stop(): void
}

/** `lag-2026-10-27T08-12-17-745Z.trace.json`, beside the lag's cpuprofile. */
export function lagTraceName(at: Date): string {
  return `lag-${at.toISOString().replace(/[:.]/g, '-')}.trace.json`
}

/** Of a log folder's names, the traces beyond the newest `keep`. */
export function tracesToPrune(names: string[], keep = TRACE_KEEP): string[] {
  const ours = names.filter((n) => /^lag-.*\.trace\.json$/.test(n)).sort()
  return ours.slice(0, Math.max(0, ours.length - keep))
}

export function startNativeTrace(deps: NativeTraceDeps): NativeTrace {
  const { log, tracing } = deps
  const now = deps.now ?? Date.now
  const wall = deps.wall ?? ((): Date => new Date())
  const keep = deps.keep ?? TRACE_KEEP
  const minGap = deps.minGapMs ?? MIN_GAP_MS
  let recording = false
  let busy = false
  let stopped = false
  let lastDump = -Infinity

  const begin = (): void => {
    if (stopped) return
    tracing
      .startRecording({
        recording_mode: 'record-continuously',
        trace_buffer_size_in_kb: TRACE_BUFFER_KB,
        included_categories: TRACE_CATEGORIES
      })
      .then(
        () => {
          recording = true
        },
        (err: unknown) => {
          recording = false
          log.write('main', 'lag-trace', { startFailed: true, err: String(err) })
        }
      )
  }

  const prune = async (): Promise<void> => {
    const names = await readdir(log.dir)
    await Promise.all(
      tracesToPrune(names, keep).map((n) => unlink(join(log.dir, n)).catch(() => {}))
    )
  }

  /** A lag just ended: name its file now, dump the buffer into it. */
  const onLag = (ms: number): string | null => {
    if (!recording || busy || stopped || now() - lastDump < minGap) return null
    busy = true
    recording = false
    lastDump = now()
    const name = lagTraceName(wall())
    const t0 = now()
    // A `lag-trace` line once the file is down (or could not be): how long
    // the dump took, and the e2e's signal that the file is complete.
    tracing
      .stopRecording(join(log.dir, name))
      .then(
        () => {
          log.write('main', 'lag-trace', { trace: name, lagMs: ms, dumpMs: now() - t0 })
          return prune().catch(() => {})
        },
        (err: unknown) =>
          log.write('main', 'lag-trace', {
            trace: name,
            lagMs: ms,
            missing: true,
            err: String(err)
          })
      )
      .finally(() => {
        busy = false
        begin()
      })
    return name
  }

  const write = log.write
  log.write = (src, k, fields) => {
    const ms = fields?.ms
    if (src === 'main' && k === 'main-lag' && typeof ms === 'number' && ms >= LAG_PROFILE_MIN_MS) {
      let trace: string | null = null
      try {
        trace = onLag(ms)
      } catch {
        /* a recorder never takes the app down */
      }
      if (trace) fields = { ...fields, trace }
    }
    write(src, k, fields)
  }

  begin()

  return {
    stop: () => {
      stopped = true
      log.write = write
      // Not stopRecording(): with no path it writes the buffer to a temp
      // file. The buffer goes with the process.
      recording = false
    }
  }
}
