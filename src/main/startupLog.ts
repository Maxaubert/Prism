/**
 * HOW LONG A START TOOK, IN THE LOG (owner, 2026-11-06; the audit
 * research/prism/2026-11-06-logging-startup-stalls-audit.md: "it doesn't
 * record startup time or the hotkey path. That gap is where your 5 seconds
 * goes"). One `startup` line per launch and per wake from standby, written
 * once the window has shown its first folder (and, for a Win+E, once the
 * helper has been told), or after `timeoutMs` with what it has (`partial`).
 *
 * Every mark is the diagnostics log's own clock (`up`, ms since the process
 * began), so the line reads against the session line and every other line of
 * the same launch. A wake's marks are the same clock; `from` says when the
 * wake began, and the `*Ms` fields are the spans that matter, from it.
 */

/** Why this launch (or wake) happened. */
export type LaunchReason = 'win-e' | 'folder' | 'file' | 'plain' | 'standby-wake'

/** The moments a launch passes, in order. */
export const STARTUP_MARKS = ['ready', 'made', 'readyToShow', 'shown', 'listed', 'restored', 'winEAck'] as const
export type StartupMark = (typeof STARTUP_MARKS)[number]

/** A launch (or a wake) still being timed. */
export interface Launch {
  readonly reason: LaunchReason
  /** The first time this launch passes `name`; later ones are ignored. */
  mark(name: StartupMark): void
  /** Written already (or given up). */
  done(): boolean
}

export interface StartupLogDeps {
  /** One `startup` line. */
  write(fields: Record<string, unknown>): void
  /** The log's clock (`up`). */
  up(): number
  /** Give up waiting after this long, writing what there is. */
  timeoutMs?: number
  after?(fn: () => void, ms: number): { cancel(): void }
}

/** The reason a COLD launch gives, from its arguments: a Win+E request (the
 *  folder verb's too, which carries `browse`), else what it was handed. */
export function launchReason(args: { winE: boolean; paths: ReadonlyArray<{ dir: boolean }> }): LaunchReason {
  if (args.winE) return 'win-e'
  if (args.paths.some((p) => !p.dir)) return 'file'
  if (args.paths.length) return 'folder'
  return 'plain'
}

/** The process's start, from the OS (Electron's `process.getCreationTime`),
 *  and how long it took from there to `nowMs` (the session line): the part of a
 *  cold start Prism's own code never saw. Null when the OS will not say. */
export function bootFields(created: number | null | undefined, nowMs: number): { created: number; bootMs: number } | null {
  if (typeof created !== 'number' || !Number.isFinite(created) || created <= 0) return null
  return { created: Math.round(created), bootMs: Math.max(0, Math.round(nowMs - created)) }
}

export function createStartupLog(deps: StartupLogDeps): {
  /** Begin timing a launch (`from` 0, the process's start) or a wake. */
  begin(reason: LaunchReason, opts?: { winE?: boolean; from?: number; extra?: Record<string, unknown> }): Launch
} {
  const timeoutMs = deps.timeoutMs ?? 30_000
  const after =
    deps.after ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return { cancel: () => clearTimeout(t) }
    })
  return {
    begin(reason, opts = {}) {
      const from = opts.from ?? deps.up()
      const winE = !!opts.winE
      const marks = new Map<StartupMark, number>()
      let written = false
      const write = (partial: boolean): void => {
        if (written) return
        written = true
        timer.cancel()
        const fields: Record<string, unknown> = { reason, from }
        for (const m of STARTUP_MARKS) if (marks.has(m)) fields[m] = marks.get(m)
        const span = (m: StartupMark): number | undefined => (marks.has(m) ? marks.get(m)! - from : undefined)
        fields.shownMs = span('shown')
        fields.listedMs = span('listed')
        if (winE) fields.winEMs = span('winEAck')
        if (partial) fields.partial = true
        deps.write({ ...fields, ...(opts.extra ?? {}) })
      }
      const complete = (): boolean => marks.has('shown') && marks.has('listed') && (!winE || marks.has('winEAck'))
      const timer = after(() => write(true), timeoutMs)
      return {
        reason,
        mark(name) {
          if (written || marks.has(name)) return
          marks.set(name, Math.round(deps.up()))
          if (complete()) write(false)
        },
        done: () => written
      }
    }
  }
}
