/**
 * How a dead page is brought back (#265; owner, 2026-10-03: "prism suddenly
 * stopped opening, not sure why, but that should never happen").
 *
 * A renderer that died once is reloaded: it is the cheap fix and the page
 * restores its own tabs. One that keeps dying in the same window is not going
 * to be cured by a third reload, so the WINDOW is rebuilt (a fresh
 * BrowserWindow, a fresh renderer process). If that one dies just as fast,
 * there is nothing left to try inside this process, and Prism gives up and
 * QUITS: a process with no working window holds the single-instance lock and
 * swallows every later launch, which is exactly the state that was found (the
 * main process alive and idle 45 minutes on, no renderer, no window). Quitting
 * frees the lock, so the next double-click starts clean.
 *
 * Pure, so the arithmetic is tested without Electron.
 */
export type Recovery = 'reload' | 'recreate' | 'give-up'

export interface CrashBudgetOptions {
  /** Deaths inside `windowMs` that turn a reload into a rebuild. */
  limit?: number
  windowMs?: number
  /** Rebuilds allowed inside `recreateWindowMs` before giving up. */
  recreates?: number
  recreateWindowMs?: number
}

export interface CrashBudget {
  /** Count one death at `now` and say what to do about it. */
  record(now: number): Recovery
  /**
   * This run has died more than once (#265, review): a second death inside
   * `windowMs`, or a rebuild inside `recreateWindowMs`. The page then comes
   * back WITHOUT its saved tabs, since a restored tab may be what kills it,
   * and reopening it on every recovery would end in a quit, and the same
   * quit at every later launch. One death on its own keeps the tabs.
   */
  strained(now: number): boolean
}

export function crashBudget({
  limit = 3,
  windowMs = 120_000,
  recreates = 1,
  recreateWindowMs = 600_000
}: CrashBudgetOptions = {}): CrashBudget {
  let deaths: number[] = []
  let rebuilt: number[] = []
  return {
    record(now) {
      deaths = deaths.filter((t) => now - t < windowMs)
      deaths.push(now)
      if (deaths.length < limit) return 'reload'
      // The rebuilt window starts its own count: its first deaths are reloads
      // again, and only the same run of deaths after a rebuild gives up.
      deaths = []
      rebuilt = rebuilt.filter((t) => now - t < recreateWindowMs)
      if (rebuilt.length < recreates) {
        rebuilt.push(now)
        return 'recreate'
      }
      return 'give-up'
    },
    strained(now) {
      return (
        deaths.filter((t) => now - t < windowMs).length >= 2 ||
        rebuilt.some((t) => now - t < recreateWindowMs)
      )
    }
  }
}
