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

// Whether the USER has typed into a session (keystrokes, paste, a dropped
// path) - the signal the reroot policy runs on: an untouched shell follows
// the tab to its new folder; a touched one (a Claude session, half-typed
// work) stays where it is.
const touchedIds = new Set<string>()

export function markTouched(id: string): void {
  touchedIds.add(id)
}

export function isTouched(id: string): boolean {
  return touchedIds.has(id)
}

/** A session ended: forget everything about it. */
export function forgetSession(id: string): void {
  touchedIds.delete(id)
  until.delete(id)
}
