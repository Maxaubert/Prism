import { Session } from 'node:inspector'
import { readdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { performance } from 'perf_hooks'
import type { DiagLog } from 'prism-term-core/main/diagLog'
import { summarizeLag, type CpuProfile } from './lagSummary'

/**
 * A MAIN-LAG CARRIES ITS OWN CPU PROFILE (owner, 2026-10-12, "handle this":
 * e2e runs showed 3 to 10 s main-process freezes with only finished, fast IPC
 * in flight, so the `inflight` list could not say what main was doing). While
 * it is on, main runs V8's sampling profiler (1 ms) from its own inspector
 * session in short windows: every 5 s the window is stopped and a new one
 * started, and the last finished one is kept. A `main-lag` of 1 s or more
 * stops the running window at once and writes the windows covering the lag
 * to the log folder as `lag-<time>.cpuprofile` (open it in Chrome DevTools'
 * Performance panel, or read it with any .cpuprofile tool); the line names
 * the file in `profile`, and a `lag-profile` line after it says how much of
 * the lag was JavaScript and where (lagSummary.ts). Only the newest ten
 * files are kept.
 *
 * Which window holds the lag: the rotation is a timer on main, so it cannot
 * fire WHILE main is blocked, but it can fire right AFTER, before the
 * detector's tick logs the lag (both timers came due during the block, the
 * rotation first). The lag is then in the window just finished, not the one
 * running. So the file named in the line (and summarised) is whichever window
 * overlaps the lag most, and a window that holds only part of it is kept
 * beside it as `-prev` (review, 2026-10-12).
 *
 * ON UNDER THE E2E (`--e2e`), WHILE DETAILED LOGGING IS ON (Settings >
 * Diagnostics), AND FOR EVERY LAUNCH'S FIRST STARTUP_PROFILE_MS (2026-10-27),
 * checked every rotation, so a switch takes effect within 5 s. Off, there is
 * no session, no profiler and nothing written.
 *
 * The detector itself is the terminal core's (`stallWatch`): this wraps the
 * log's `write`, which the detector calls, so nothing in the core changes.
 */

export const LAG_PROFILE_MIN_MS = 1000
/** Every launch profiles its own first half minute, whatever the setting. */
export const STARTUP_PROFILE_MS = 30_000
export const LAG_PROFILE_KEEP = 10
export const LAG_WINDOW_MS = 5000
/** The detector's tick: the lag is measured from the tick before it. */
const TICK_MS = 50

export interface ProfileWindow {
  /** performance.now() ms. */
  start: number
  end: number
  profile: unknown
}

/** The windows that overlap [from, to], the one holding most of it first
 *  (newest first on a tie). */
export function windowsCovering(
  windows: (ProfileWindow | null)[],
  from: number,
  to: number
): ProfileWindow[] {
  const held = (w: ProfileWindow): number => Math.min(w.end, to) - Math.max(w.start, from)
  return windows
    .filter((w): w is ProfileWindow => !!w && w.start <= to && w.end >= from)
    .sort((a, b) => held(b) - held(a) || b.start - a.start)
}

/** `lag-2026-10-12T09-30-01-123Z.cpuprofile`: an ISO time with no colons
 *  (Windows), so the names also sort by time. An older window adds `-prev`. */
export function lagProfileName(at: Date, older = 0): string {
  const iso = at.toISOString().replace(/[:.]/g, '-')
  return `lag-${iso}${older ? `-prev${older > 1 ? older : ''}` : ''}.cpuprofile`
}

/** Of a log folder's names, the lag profiles beyond the newest `keep`. */
export function profilesToPrune(names: string[], keep = LAG_PROFILE_KEEP): string[] {
  const ours = names.filter((n) => /^lag-.*\.cpuprofile$/.test(n)).sort()
  return ours.slice(0, Math.max(0, ours.length - keep))
}

/** The slice of node:inspector's Session the profiler uses. */
export interface SessionLike {
  connect(): void
  disconnect(): void
  post(method: string, params?: object, cb?: (err: Error | null, result?: unknown) => void): void
}

export interface LagProfilerDeps {
  log: DiagLog
  enabled(): boolean
  session?: () => SessionLike
  now?: () => number
  wall?: () => Date
  windowMs?: number
  keep?: number
}

export interface LagProfiler {
  /** Stop the current window and start the next (the timer's job). */
  rotate(): void
  stop(): void
}

export function startLagProfiler(deps: LagProfilerDeps): LagProfiler {
  const { log } = deps
  const now = deps.now ?? ((): number => performance.now())
  const wall = deps.wall ?? ((): Date => new Date())
  const keep = deps.keep ?? LAG_PROFILE_KEEP
  let session: SessionLike | null = null
  let curStart = 0
  let prev: ProfileWindow | null = null

  const safe = (fn: () => void): void => {
    try {
      fn()
    } catch {
      /* a recorder never takes the app down */
    }
  }

  const post = (method: string, params?: object): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (!session) return reject(new Error('no session'))
      session.post(method, params, (err, result) => (err ? reject(err) : resolve(result)))
    })

  const begin = (): void => {
    const s = (deps.session ?? ((): SessionLike => new Session()))()
    // Kept only once connected: a session that cannot connect is tried again
    // at the next rotation instead of being posted to for ever.
    s.connect()
    session = s
    void post('Profiler.enable')
    void post('Profiler.setSamplingInterval', { interval: 1000 })
    void post('Profiler.start')
    curStart = now()
  }

  const end = (): void => {
    const s = session
    session = null
    prev = null
    if (!s) return
    safe(() => s.post('Profiler.stop', undefined, () => safe(() => s.disconnect())))
  }

  /** Stop the running window, start the next; resolves with the stopped one. */
  const cut = (): Promise<ProfileWindow | null> => {
    if (!session) return Promise.resolve(null)
    const start = curStart
    const stopped = post('Profiler.stop').then(
      (r) => ({
        start,
        end: now(),
        profile: (r as { profile?: unknown } | undefined)?.profile ?? null
      }),
      () => null
    )
    void post('Profiler.start').catch(() => {})
    curStart = now()
    return stopped
  }

  const prune = async (): Promise<void> => {
    const names = await readdir(log.dir)
    await Promise.all(
      profilesToPrune(names, keep).map((n) => unlink(join(log.dir, n)).catch(() => {}))
    )
  }

  const rotate = (): void =>
    safe(() => {
      const on = deps.enabled()
      if (!on) return end()
      if (!session) return begin()
      void cut().then((w) => {
        if (w?.profile) prev = w
      })
    })

  /** A lag just ended: name its file now, write it when the profile lands. */
  const onLag = (ms: number): string | null => {
    if (!session) return null
    const lagEnd = now()
    const lagStart = lagEnd - ms - TICK_MS
    const at = wall()
    const name = lagProfileName(at)
    const older = prev
    void cut().then(async (w) => {
      const chosen = windowsCovering([w, older], lagStart, lagEnd)
      if (w?.profile) prev = w
      // What the profile says about the lag, in the log itself: JavaScript
      // (and where) or time outside it (lagSummary.ts). No window at all (the
      // profiler failed to stop) says so, since the line already named a file.
      safe(() => {
        const main = chosen[0]
        if (!main) return log.write('main', 'lag-profile', { profile: name, lagMs: ms, missing: true })
        // The window ended at most a tick past the lag: its last `ms` are it.
        const late = Math.max(0, main.end - lagEnd)
        const summary = summarizeLag(main.profile as CpuProfile, ms, 3, late)
        if (summary) log.write('main', 'lag-profile', { profile: name, lagMs: ms, ...summary })
      })
      await Promise.all(
        chosen.map((c, i) =>
          writeFile(join(log.dir, lagProfileName(at, i)), JSON.stringify(c.profile)).catch(() => {})
        )
      )
      await prune().catch(() => {})
    })
    return name
  }

  const write = log.write
  log.write = (src, k, fields) => {
    const ms = fields?.ms
    if (src === 'main' && k === 'main-lag' && typeof ms === 'number' && ms >= LAG_PROFILE_MIN_MS) {
      let profile: string | null = null
      safe(() => {
        profile = onLag(ms)
      })
      if (profile) fields = { ...fields, profile }
    }
    write(src, k, fields)
  }

  rotate()
  const timer = setInterval(rotate, deps.windowMs ?? LAG_WINDOW_MS)
  timer.unref?.()

  return {
    rotate,
    stop: () => {
      clearInterval(timer)
      log.write = write
      end()
    }
  }
}
