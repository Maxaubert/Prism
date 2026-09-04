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

/**
 * Is this onData payload something a person produced? Terminal REPLIES all
 * start with ESC (focus reports, DA, CPR, OSC colour answers); so do the
 * keys that matter (arrows, Escape), but those arrive on onKey and are
 * marked there. What is left for this test is plain text: an IME commit.
 */
export function looksTyped(data: string): boolean {
  return data.length > 0 && !data.startsWith('\x1b')
}

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

// Sessions born to RESUME a Claude conversation, mapped to the conversation's
// session id: the restore flow marks them, the spawn carries the id so main
// launches the shell with `claude --resume <id>` as its startup command -
// never typed on screen (owner decision, 2026-08-21).
const resumeIds = new Map<string, string>()

export function markResume(id: string, session: string): void {
  resumeIds.set(id, session)
}

/** One-shot: the session id exactly once per marked terminal. */
export function takeResume(id: string): string | null {
  const session = resumeIds.get(id) ?? null
  resumeIds.delete(id)
  return session
}

/** A session ended: forget everything about it. */
export function forgetSession(id: string): void {
  touchedIds.delete(id)
  lastInput.delete(id)
  until.delete(id)
  resumeIds.delete(id)
  lastPrompt.delete(id)
}

// The shell's PROMPT reports its folder (#99), and a report is also the one
// reliable "I am idle" signal a pty gives: nothing prints a prompt while a
// command runs. A keystroke after it means somebody is typing on that prompt,
// so the shell is idle but the line is not empty - and a Set-Location written
// then would run whatever was half-typed in front of it.
const lastPrompt = new Map<string, number>()

export function markPrompt(id: string): void {
  lastPrompt.set(id, Date.now())
}

/** A prompt has appeared, and nothing has been typed since it did. */
export function idleAtPrompt(id: string): boolean {
  const p = lastPrompt.get(id)
  return p !== undefined && p > (lastInput.get(id) ?? 0)
}
