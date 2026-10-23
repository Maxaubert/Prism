/**
 * WHAT A KEY OVER A SHELL DOES, decided apart from xterm (moved out of
 * TerminalPanel's createSession, audit 2026-10-12, so the order of the rules
 * has tests). The panel acts on the answer; 'xterm' leaves the key to xterm.
 */
export type TermKeyAction =
  /** Ctrl+C over a selection: copy it, the way Windows Terminal does. */
  | 'copy'
  /** Backspace or Delete deleted the selection on the line being edited. */
  | 'deleted'
  /** One of the host's chords: neither xterm nor the pty sees it. */
  | 'host'
  /** Shift+Enter where an agent runs: its newline-without-submit. */
  | 'newline'
  /** Ctrl+V: the one paste. */
  | 'paste'
  /** Ctrl+Shift+V: plain text, even when an image rides along. */
  | 'paste-plain'
  | 'xterm'

export interface TermKeyEvent {
  type: string
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** Ctrl+C and Ctrl+V are matched by the PHYSICAL key as well as the letter
 *  (code review 2026-09-24, #6; regression rule 11): on a Russian or Greek
 *  layout the C key's `key` is not 'c', xterm still maps it to ^C, and a copy
 *  over a selection interrupted the agent instead. Windows Terminal matches
 *  the key the same way. */
export const isKey = (e: Pick<TermKeyEvent, 'key' | 'code'>, letter: 'c' | 'v'): boolean =>
  e.key.toLowerCase() === letter || e.code === `Key${letter.toUpperCase()}`

export function termKeyAction(
  e: TermKeyEvent,
  s: {
    hasSelection: boolean
    /** Try to delete the selection on the edited line; true when it did. */
    deleteSelection: () => boolean
    /** The host's `ownsKey` (Prism Terminal: lib/keymap). */
    hostOwns: (e: TermKeyEvent) => boolean
    /** An agent runs in this shell (agentArm). */
    agentHere: boolean
  }
): TermKeyAction {
  if (e.type !== 'keydown') return 'xterm'
  // With nothing selected Ctrl+C stays the interrupt every shell expects.
  if (isKey(e, 'c') && e.ctrlKey && !e.shiftKey && !e.altKey && s.hasSelection) return 'copy'
  // Backspace or Delete over a selection on the line being edited deletes it
  // (owner, 2026-09-23); anywhere else the key is the shell's as ever.
  if (
    (e.key === 'Backspace' || e.key === 'Delete') &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.metaKey &&
    s.hasSelection &&
    s.deleteSelection()
  )
    return 'deleted'
  // THE HOST'S CHORDS: which keys belong to the app even over a focused shell
  // is the one thing the two apps disagree about, so the host says. xterm
  // must not ALSO feed the bytes to the pty: left to xterm, Ctrl+` became a
  // NUL, which counted as the user typing.
  if (s.hostOwns(e)) return 'host'
  // ONLY where an agent runs (code review 2026-09-24, #21): at a plain prompt
  // `\` then Enter RAN the line with a backslash on its end, a command nobody
  // wrote. There Shift+Enter is Enter, as xterm sends it.
  if (e.key === 'Enter' && e.shiftKey && s.agentHere) return 'newline'
  if (isKey(e, 'v') && e.ctrlKey && !e.altKey) return e.shiftKey ? 'paste-plain' : 'paste'
  return 'xterm'
}
