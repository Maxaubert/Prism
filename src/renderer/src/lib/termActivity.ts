// Shared between App (which scores activity) and TerminalPanel (which causes
// some of it): output provoked by OUR OWN resizes is not the shell working,
// it is the shell repainting because we moved its walls. A sidebar toggle
// animates width, the observer fires repeatedly, and the chained redraws
// otherwise read as a sustained run.

const until = new Map<string, number>()

/** Ignore this session's output for run-scoring for a moment. */
export function suppressActivity(id: string, ms = 800): void {
  until.set(id, Date.now() + ms)
}

export function activitySuppressed(id: string): boolean {
  return Date.now() < (until.get(id) ?? 0)
}
