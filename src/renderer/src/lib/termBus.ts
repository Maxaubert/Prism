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

// Where each shell says it is (#99). TerminalPanel hears the prompt's report
// through xterm's OSC parser and posts it here; App listens, because the
// tree and the tab root are its to move.
const cwdListeners = new Set<(sessionId: string, path: string) => void>()

export function reportCwd(sessionId: string, path: string): void {
  cwdListeners.forEach((fn) => fn(sessionId, path))
}

export function onCwd(fn: (sessionId: string, path: string) => void): () => void {
  cwdListeners.add(fn)
  return () => {
    cwdListeners.delete(fn)
  }
}

// What each shell's TITLE says (2026-09-04): Claude Code writes its working
// state into it, and App turns that into the tab indicator the moment it
// arrives. TerminalPanel hears xterm's title event and posts it here.
const titleListeners = new Set<(sessionId: string, title: string) => void>()

export function reportTitle(sessionId: string, title: string): void {
  titleListeners.forEach((fn) => fn(sessionId, title))
}

export function onTitle(fn: (sessionId: string, title: string) => void): () => void {
  titleListeners.add(fn)
  return () => {
    titleListeners.delete(fn)
  }
}
