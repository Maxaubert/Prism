import { readdir, stat, unlink } from 'fs/promises'
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
 * again RESTART_MS later. A `lag-trace` line says when a dump failed.
 *
 * A DUMP NEVER ADDS TO THE STALL IT RECORDS (performance review, 2026-10-28:
 * "look for stall points, things that use up too many resources"). The
 * owner's log showed an 8 MB buffer of every task AND every IPC and mojo
 * message in every process dumping for 6.2 s into a 43 MB file, main lagging
 * 2.6 s during it and 8.8 s after recording restarted at once, and a dump cut
 * off by quit left a 13 MB `<guid>.tmp` that nothing removed. So: the buffer
 * is 2 MB of `toplevel` and Electron's own events (what names a long task;
 * `ipc`, `mojom`, `gpu` and `loading` filled the buffer many times faster,
 * so a 2 MB buffer of them would hold only the last moments, and no dump has
 * needed them); one dump every MIN_GAP_MS; none while the disk is already
 * slow (an `fs-slow` line in the last DISK_QUIET_MS: the dump would write
 * megabytes to the disk that is the stall); none once the app is quitting;
 * and recording comes back RESTART_MS after a dump, not at once. A main-lag
 * while a dump runs or within AFTER_DUMP_MS of it says `afterDump: true`, so
 * a dump's own cost shows in the log, and the CPU profiler skips those
 * (lagProfiler.ts). Old traces go by count AND by total bytes, and a trace's
 * `.tmp` left by an unfinished dump is removed a minute after launch.
 *
 * Wraps the log's `write` the way lagProfiler.ts does, so the detector (the
 * core's stallWatch) is unchanged.
 */

export const TRACE_BUFFER_KB = 2 * 1024
export const TRACE_KEEP = 5
/** Kept traces never add up to more than this (the newest is always kept). */
export const TRACE_MAX_BYTES = 50 * 1024 * 1024
export const MIN_GAP_MS = 10 * 60_000
/** Recording starts again this long after a dump. */
export const RESTART_MS = 30_000
/** A lag this soon after a dump (or during one) is marked `afterDump`. */
export const AFTER_DUMP_MS = 30_000
/** No dump this soon after the disk canary said `fs-slow`. */
export const DISK_QUIET_MS = 30_000
/** How long after launch the leftover `.tmp` sweep waits (off the startup path). */
export const TMP_SWEEP_DELAY_MS = 60_000
export const TRACE_CATEGORIES = ['toplevel', 'electron', 'startup', 'navigation']

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
  maxBytes?: number
  minGapMs?: number
  restartMs?: number
  /** When the leftover `.tmp` sweep runs. */
  sweepDelayMs?: number
}

export interface NativeTrace {
  /** The app is quitting: no more dumps or restarts, write goes back. */
  stop(): void
}

/** `lag-2026-10-27T08-12-17-745Z.trace.json`, beside the lag's cpuprofile. */
export function lagTraceName(at: Date): string {
  return `lag-${at.toISOString().replace(/[:.]/g, '-')}.trace.json`
}

/** A log folder entry, with its size and time when it was looked at. */
export interface TraceFile {
  name: string
  size?: number
  mtimeMs?: number
}

const isTrace = (name: string): boolean => /^lag-.*\.trace\.json$/.test(name)

/** Of a log folder's entries, the traces to remove: those beyond the newest
 *  `keep`, then the oldest while the rest add up to more than `maxBytes`. The
 *  newest is always kept, however big. */
export function tracesToPrune(
  files: Array<string | TraceFile>,
  keep = TRACE_KEEP,
  maxBytes = Infinity
): string[] {
  const ours = files
    .map((f) => (typeof f === 'string' ? { name: f } : f))
    .filter((f) => isTrace(f.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const gone = new Set(ours.slice(0, Math.max(0, ours.length - keep)).map((f) => f.name))
  let bytes = 0
  for (let i = ours.length - 1; i >= 0; i -= 1) {
    const f = ours[i]
    if (gone.has(f.name)) continue
    bytes += f.size ?? 0
    if (bytes > maxBytes && i < ours.length - 1) gone.add(f.name)
  }
  return ours.filter((f) => gone.has(f.name)).map((f) => f.name)
}

/** Chromium writes a dump to a `<guid>.tmp` in the folder and renames it when
 *  done, so one cut off by quit stays. Of a folder's entries, those older than
 *  `before` (ms since the epoch): never a dump this session may be writing. */
export function leftoverTraceTmps(files: TraceFile[], before: number): string[] {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i
  return files
    .filter((f) => guid.test(f.name) && f.mtimeMs !== undefined && f.mtimeMs < before)
    .map((f) => f.name)
}

export function startNativeTrace(deps: NativeTraceDeps): NativeTrace {
  const { log, tracing } = deps
  const now = deps.now ?? Date.now
  const wall = deps.wall ?? ((): Date => new Date())
  const keep = deps.keep ?? TRACE_KEEP
  const maxBytes = deps.maxBytes ?? TRACE_MAX_BYTES
  const minGap = deps.minGapMs ?? MIN_GAP_MS
  const restartMs = deps.restartMs ?? RESTART_MS
  const startedAt = wall().getTime()
  let recording = false
  let busy = false
  let stopped = false
  let lastDump = -Infinity
  let dumpEnded = -Infinity
  let lastSlowDisk = -Infinity
  let restart: ReturnType<typeof setTimeout> | null = null

  const begin = (): void => {
    restart = null
    if (stopped) return
    tracing
      .startRecording({
        recording_mode: 'record-continuously',
        trace_buffer_size_in_kb: TRACE_BUFFER_KB,
        included_categories: TRACE_CATEGORIES
      })
      .then(
        () => {
          recording = !stopped
        },
        (err: unknown) => {
          recording = false
          log.write('main', 'lag-trace', { startFailed: true, err: String(err) })
        }
      )
  }

  const look = (names: string[]): Promise<TraceFile[]> =>
    Promise.all(
      names.map((name) =>
        stat(join(log.dir, name)).then(
          (st) => ({ name, size: st.size, mtimeMs: st.mtimeMs }),
          () => ({ name })
        )
      )
    )

  const remove = (names: string[]): Promise<unknown> =>
    Promise.all(names.map((n) => unlink(join(log.dir, n)).catch(() => {})))

  const prune = async (): Promise<void> => {
    const names = (await readdir(log.dir)).filter(isTrace)
    await remove(tracesToPrune(await look(names), keep, maxBytes))
  }

  const sweep = async (): Promise<void> => {
    const tmps = (await readdir(log.dir)).filter((n) => n.endsWith('.tmp'))
    await remove(leftoverTraceTmps(await look(tmps), startedAt))
    await prune()
  }

  /** A lag just ended: name its file now, dump the buffer into it. */
  const onLag = (ms: number): string | null => {
    if (!recording || busy || stopped || now() - lastDump < minGap) return null
    if (now() - lastSlowDisk < DISK_QUIET_MS) return null
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
        dumpEnded = now()
        if (stopped) return
        restart = setTimeout(begin, restartMs)
        restart.unref?.()
      })
    return name
  }

  const write = log.write
  log.write = (src, k, fields) => {
    const ms = fields?.ms
    if (src === 'main' && k === 'fs-slow') lastSlowDisk = now()
    if (src === 'main' && k === 'main-lag' && typeof ms === 'number') {
      if (busy || now() - dumpEnded < AFTER_DUMP_MS) fields = { ...fields, afterDump: true }
      else if (ms >= LAG_PROFILE_MIN_MS) {
        let trace: string | null = null
        try {
          trace = onLag(ms)
        } catch {
          /* a recorder never takes the app down */
        }
        if (trace) fields = { ...fields, trace }
      }
    }
    write(src, k, fields)
  }

  begin()
  const sweepTimer = setTimeout(
    () => void sweep().catch(() => {}),
    deps.sweepDelayMs ?? TMP_SWEEP_DELAY_MS
  )
  sweepTimer.unref?.()

  return {
    stop: () => {
      stopped = true
      log.write = write
      clearTimeout(sweepTimer)
      if (restart) clearTimeout(restart)
      // Not stopRecording(): with no path it writes the buffer to a temp
      // file. The buffer goes with the process; a dump already running may
      // leave its `.tmp`, which the next launch sweeps.
      recording = false
    }
  }
}
