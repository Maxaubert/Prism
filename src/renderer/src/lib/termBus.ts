/**
 * Reaching a live terminal from outside its own component.
 *
 * The dock's right-click menu wants Paste, and pasting into a terminal is not
 * "write these bytes to the pty" (2026-08-30). It is xterm's `paste()`, which
 * wraps the text in the bracketed-paste escape the shell is waiting for -
 * without it a multi-line paste arrives as a run of Enter presses, so the
 * first line executes and the rest are typed in after it. An image on the
 * clipboard is different again: the ^V KEYSTROKE is forwarded so the TUI
 * reads the clipboard itself, which is how Claude Code takes a screenshot.
 *
 * All of that already exists, once, in TerminalPanel's key handler. This lets
 * the menu call THAT rather than growing a second, wrong copy of it.
 */

const pasters = new Map<string, () => void>()

/** TerminalPanel registers its own paste while it is mounted. */
export function registerPaste(sessionId: string, fn: () => void): () => void {
  if (!sessionId) return () => {}
  pasters.set(sessionId, fn)
  return () => {
    if (pasters.get(sessionId) === fn) pasters.delete(sessionId)
  }
}

/** True when there was a terminal to paste into. */
export function pasteInto(sessionId: string): boolean {
  const fn = pasters.get(sessionId)
  if (!fn) return false
  fn()
  return true
}
