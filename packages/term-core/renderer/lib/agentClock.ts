// How long an agent has been working, which nothing in Prism knew until now
// (2026-08-31).
//
// `outputRuns` looks like it holds the answer and does not: its `start` is
// reset whenever the stream goes quiet for 1.5 seconds, so an agent that
// pauses to think restarts the clock. It measures a BURST, deliberately, and
// that is what the indicator wants. A duration wants the other thing: when
// this session ENTERED the working set and stayed there.
//
// So the working set is reconciled against a map of start times. One call a
// tick, and the tick already exists. Everything else about it is arithmetic,
// which is why this file is pure enough to test.

const startedAt = new Map<string, number>()

/**
 * Reconcile the clock against the current working set.
 *
 * A session that has just started working gets `now`; one that has stopped
 * is forgotten. That covers the ends too: a shell that exits, a tab that
 * closes and an agent that quits all leave the working set within a tick,
 * because each of them deletes the session's output run.
 */
export function noteWorking(ids: ReadonlySet<string>, now = Date.now()): void {
  for (const id of ids) if (!startedAt.has(id)) startedAt.set(id, now)
  for (const id of [...startedAt.keys()]) if (!ids.has(id)) startedAt.delete(id)
}

/** How long this session has been working, or null if it is not. */
export function workingFor(id: string, now = Date.now()): number | null {
  const at = startedAt.get(id)
  return at === undefined ? null : Math.max(0, now - at)
}

/** For tests: the clock, wound back to nothing. */
export function resetClock(): void {
  startedAt.clear()
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`

/**
 * A duration in words, for a sentence rather than a readout.
 *
 * Rounded down and coarse on purpose: this appears in "Claude has been
 * working for about 3 minutes", where the difference between 3:12 and 3:47
 * decides nothing. Under ten seconds it says "a few seconds" - a precise
 * "7 seconds" invites you to watch it count, and the answer to "has it been
 * long?" there is no.
 */
export function humanFor(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  if (s < 10) return 'a few seconds'
  if (s < 60) return plural(s, 'second')
  const m = Math.floor(s / 60)
  if (m < 60) return plural(m, 'minute')
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${plural(h, 'hour')} ${plural(rest, 'minute')}` : plural(h, 'hour')
}
