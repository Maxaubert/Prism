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
// When they last did. Output right after a keystroke is the ECHO of that
// keystroke - a TUI repainting its input box as you type - not the agent
// working. While you keep typing, every keystroke renews the window, so a
// typing streak never scores; an agent genuinely answering keeps streaming
// long after the last key and scores normally.
const lastInput = new Map<string, number>()

export function markTouched(id: string): void {
  touchedIds.add(id)
  lastInput.set(id, Date.now())
}

/** Is this output close enough behind a keystroke to be its echo? */
export function inputEcho(id: string, ms = 350): boolean {
  return Date.now() - (lastInput.get(id) ?? 0) < ms
}

export function isTouched(id: string): boolean {
  return touchedIds.has(id)
}

// Sessions born to RESUME a Claude conversation: the restore flow marks them,
// the terminal panel sends `claude --continue` once the shell is up. This is
// the one command Prism ever writes itself (owner decision, 2026-08-21).
const resumeIds = new Set<string>()

export function markResume(id: string): void {
  resumeIds.add(id)
}

/** One-shot: true exactly once per marked session. */
export function takeResume(id: string): boolean {
  const has = resumeIds.has(id)
  resumeIds.delete(id)
  return has
}

/** A session ended: forget everything about it. */
export function forgetSession(id: string): void {
  touchedIds.delete(id)
  lastInput.delete(id)
  until.delete(id)
  resumeIds.delete(id)
}
