/**
 * THE TEAR-OFF'S SPARE IS BUILT ONLY WHEN PRISM IS IDLE (owner, 2026-11-06;
 * the audit: two of the three real freezes, 42 s and 9 minutes on
 * 2026-11-01, were inside the spare's BrowserWindow constructor, `make <
 * ensure`, called from a timer two seconds after startup). Never on a
 * startup timer any more: once startup has settled, the spare waits for a
 * quiet spell (no input in any window, no message from a page, no window
 * made, for `quietMs`), and never while Prism is in standby.
 *
 * AND IT IS WATCHED. Making one that took longer than `makeSlowMs` (the
 * constructor is synchronous, so this is measured after the fact), or whose
 * page was not ready `readyWithinMs` after, is a `spare-slow` line, and the
 * spare is given up for the rest of the session: a tear then makes its window
 * on the spot (`takeSpare`), slower by a page load but never a frozen app.
 */

export interface SpareIdleDeps {
  now(): number
  /** When anything last happened that a spare must not compete with. */
  lastActivity(): number
  /** Startup is over (the first window restored, the first answer in). */
  settled(): boolean
  /** A spare may be made now: windows open, no standby, none ready. */
  allowed(): boolean
  /** Make the spare (synchronous: the constructor is). */
  make(): void
  /** Drop a spare that never got ready. */
  drop(): void
  /** One `spare-slow` line. */
  log(fields: Record<string, unknown>): void
  quietMs?: number
  pollMs?: number
  makeSlowMs?: number
  readyWithinMs?: number
  every?(fn: () => void, ms: number): { cancel(): void }
  after?(fn: () => void, ms: number): { cancel(): void }
}

export const SPARE_QUIET_MS = 1500
export const SPARE_POLL_MS = 400
export const SPARE_MAKE_SLOW_MS = 1500
export const SPARE_READY_WITHIN_MS = 15_000

export interface SpareIdle {
  /** A spare is wanted: one is made at the next quiet spell. */
  want(): void
  /** The spare's page is ready to take a tab. */
  ready(): void
  /** No spare now (standby, the last window gone, a quit). */
  cancel(): void
  /** Given up for this session. */
  gaveUp(): boolean
}

export function createSpareIdle(deps: SpareIdleDeps): SpareIdle {
  const quietMs = deps.quietMs ?? SPARE_QUIET_MS
  const pollMs = deps.pollMs ?? SPARE_POLL_MS
  const makeSlowMs = deps.makeSlowMs ?? SPARE_MAKE_SLOW_MS
  const readyWithinMs = deps.readyWithinMs ?? SPARE_READY_WITHIN_MS
  const every =
    deps.every ??
    ((fn: () => void, ms: number) => {
      const t = setInterval(fn, ms)
      t.unref?.()
      return { cancel: () => clearInterval(t) }
    })
  const after =
    deps.after ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return { cancel: () => clearTimeout(t) }
    })
  let poll: { cancel(): void } | null = null
  let watchdog: { cancel(): void } | null = null
  let given = false

  const stopPoll = (): void => {
    poll?.cancel()
    poll = null
  }
  const giveUp = (fields: Record<string, unknown>): void => {
    given = true
    stopPoll()
    deps.log({ ...fields, gaveUp: true })
  }
  const tryMake = (): void => {
    if (given) return stopPoll()
    if (!deps.allowed()) return
    if (!deps.settled() || deps.now() - deps.lastActivity() < quietMs) return
    stopPoll()
    const t0 = deps.now()
    try {
      deps.make()
    } catch (err) {
      return giveUp({ phase: 'make', err: String(err) })
    }
    const ms = deps.now() - t0
    if (ms >= makeSlowMs) {
      // The window exists and may yet be fine; it is kept, but no other is
      // ever made this session.
      giveUp({ phase: 'make', ms })
      return
    }
    watchdog?.cancel()
    watchdog = after(() => {
      watchdog = null
      deps.drop()
      giveUp({ phase: 'ready', ms: readyWithinMs })
    }, readyWithinMs)
  }
  return {
    want() {
      if (given || poll) return
      poll = every(tryMake, pollMs)
    },
    ready() {
      watchdog?.cancel()
      watchdog = null
    },
    cancel() {
      stopPoll()
      watchdog?.cancel()
      watchdog = null
    },
    gaveUp: () => given
  }
}
