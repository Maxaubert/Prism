/**
 * THE WINDOWS CLIPBOARD WRITE, ONE AT A TIME, NEWEST WINS (#484).
 *
 * Copies used to queue in the page: a copy waited for the one before it, so
 * one write stuck for 10 s held every copy and paste behind it. Main now
 * takes every copy at once (Prism's own record, `ownClipboard`), and this
 * puts them on the Windows clipboard in order:
 *   - a newer copy STOPS the write still running (aborts its process): that
 *     one could only land the older files after the newer ones;
 *   - a write that fails is tried once more (a timeout was followed by a
 *     write that worked in the owner's log, 10 s later), unless the reason
 *     says it cannot come back (a source that is gone);
 *   - the answer says how long it took, by which way, in how many attempts,
 *     and the first failure's reason and phase when a retry was needed.
 */

export interface ClipAttempt {
  ok: boolean
  /** Why it failed: 'timeout', 'superseded', or the writer's own words. */
  reason?: string
  /** The last step the writer reported before it ended (or hung). */
  phase?: string
  /** 'powershell', or 'e2e-fake' under --e2e. */
  via: string
}

export interface ClipWrite {
  ok: boolean
  ms: number
  via: string
  attempts: number
  reason?: string
  phase?: string
  firstReason?: string
  firstPhase?: string
  superseded?: true
}

export function createClipWriter<R>(
  write: (req: R, signal: AbortSignal) => Promise<ClipAttempt>,
  opts: { now?: () => number; retries?: number; retryable?: (reason: string | undefined) => boolean } = {}
): { write(req: R): Promise<ClipWrite> } {
  const now = opts.now ?? Date.now
  const retries = opts.retries ?? 1
  const retryable = opts.retryable ?? (() => true)
  let running: { stop: AbortController; done: Promise<unknown> } | null = null

  const attempt = (req: R, signal: AbortSignal): Promise<ClipAttempt> =>
    write(req, signal).catch((e: unknown) => ({
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
      via: 'unknown'
    }))

  return {
    write(req) {
      const before = running
      before?.stop.abort()
      const stop = new AbortController()
      const done = (async (): Promise<ClipWrite> => {
        await before?.done.catch(() => {})
        const t0 = now()
        const superseded = (via: string, attempts: number): ClipWrite => ({
          ok: false,
          ms: Math.round(now() - t0),
          via,
          attempts,
          reason: 'superseded',
          superseded: true
        })
        if (stop.signal.aborted) return superseded('none', 0)
        let first: ClipAttempt | null = null
        let last: ClipAttempt = { ok: false, via: 'none' }
        let attempts = 0
        while (attempts <= retries) {
          attempts += 1
          last = await attempt(req, stop.signal)
          if (stop.signal.aborted) return superseded(last.via, attempts)
          if (last.ok || !retryable(last.reason) || attempts > retries) break
          first ??= last
        }
        return {
          ok: last.ok,
          ms: Math.round(now() - t0),
          via: last.via,
          attempts,
          ...(last.ok ? {} : { reason: last.reason ?? 'failed' }),
          ...(last.phase ? { phase: last.phase } : {}),
          ...(first ? { firstReason: first.reason ?? 'failed', ...(first.phase ? { firstPhase: first.phase } : {}) } : {})
        }
      })()
      const mine = { stop, done }
      running = mine
      void done.finally(() => {
        if (running === mine) running = null
      })
      return done
    }
  }
}
