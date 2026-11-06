/**
 * LOW-RAM STANDBY (owner, 2026-11-06: "maybe stay hidden in a mode that
 * doesnt use much compute ram, but just a state that helps it launch a lot
 * faster"). Closing the last window used to quit Prism, so every Win+E press
 * was a cold start: 0.6 s with a warm disk, 5.6 s truly cold (the audit,
 * research/prism/2026-11-06-logging-startup-stalls-audit.md). Now the last
 * window's close leaves the MAIN PROCESS running with every page gone: no
 * renderer, no spare, no ghost, the watchers' timers parked, the phone
 * server stopped, the profiler off, the process at low priority and its heap
 * collected. A Win+E, a file or folder opened from Windows, or a plain
 * relaunch (they all arrive as `second-instance`) wakes it: the parts come
 * back and a window opens, as a cold start's first window would, without the
 * process start, the module load or the session's set-up.
 *
 * What still quits for real: an update's install, Windows logging off or
 * shutting down, a window that gave up after repeated crashes, and the last
 * window closing while "Keep Prism ready" is off.
 *
 * This file is the order of things; index.ts hands in the parts.
 */

/** The preference that turns standby off (Settings > Explorer > When Prism starts). */
export const STANDBY_KEY = 'prism.standby'

/** On unless switched off. Under --e2e only when the scenario asks
 *  (`PRISM_E2E_STANDBY=1`): every other scenario ends by closing windows and
 *  counts on the process going, as the spare's switch works. */
export function standbyWanted(values: Record<string, string | undefined>, e2e: boolean, env: Record<string, string | undefined>): boolean {
  if (values[STANDBY_KEY] === 'off') return false
  return !e2e || env.PRISM_E2E_STANDBY === '1'
}

/** Why a quit happened, for the `quit` line. */
export type QuitReason = 'user' | 'last-window' | 'update' | 'session-end' | 'gave-up' | 'e2e'

/** What the last window's close does: stay in standby, or quit (and why). */
export function lastWindowClosed(s: {
  quitting: boolean
  installingUpdate: boolean
  sessionEnded: boolean
  wanted: boolean
}): { standby: true } | { standby: false; reason: QuitReason | null } {
  if (s.installingUpdate) return { standby: false, reason: 'update' }
  if (s.sessionEnded) return { standby: false, reason: 'session-end' }
  // A quit already under way names its own reason.
  if (s.quitting) return { standby: false, reason: null }
  if (!s.wanted) return { standby: false, reason: 'last-window' }
  return { standby: true }
}

/** A part of the app that rests in standby and comes back on a wake. */
export interface StandbyPart {
  name: string
  sleep(): void
  wake(): void
}

export interface StandbyDeps {
  parts: StandbyPart[]
  /** One `standby` line. */
  log(fields: Record<string, unknown>): void
  now?(): number
}

export interface Standby {
  /** In standby now. */
  on(): boolean
  /** The last window closed: every part rests. */
  enter(): void
  /** A launch arrived: every part comes back, the window is the caller's.
   *  Returns how long it rested (ms), or null when it was not resting. */
  wake(why: string): number | null
}

export function createStandby(deps: StandbyDeps): Standby {
  const now = deps.now ?? Date.now
  let since: number | null = null
  const each = (step: 'sleep' | 'wake'): string[] => {
    const failed: string[] = []
    for (const p of step === 'sleep' ? deps.parts : [...deps.parts].reverse()) {
      try {
        p[step]()
      } catch {
        // One part that will not rest or wake never keeps the rest from it.
        failed.push(p.name)
      }
    }
    return failed
  }
  return {
    on: () => since !== null,
    enter() {
      if (since !== null) return
      since = now()
      const failed = each('sleep')
      deps.log({ ev: 'enter', ...(failed.length ? { failed } : {}) })
    },
    wake(why) {
      if (since === null) return null
      const rested = now() - since
      since = null
      const failed = each('wake')
      deps.log({ ev: 'wake', why, restedMs: rested, ...(failed.length ? { failed } : {}) })
      return rested
    }
  }
}
