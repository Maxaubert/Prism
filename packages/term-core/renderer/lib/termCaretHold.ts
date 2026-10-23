/**
 * THE CARET FOLLOWS TYPING, NOT A STREAMING AGENT (#101; spec
 * docs/superpowers/specs/2026-09-29-caret-follows-typing-design.md).
 *
 * Magnifiers and screen readers follow xterm's helper textarea, which xterm
 * puts on the buffer cursor at the end of every write. MEASURED: in Claude
 * Code's inline view every streaming frame ends with the cursor on the output
 * row, above the input row, so the caret those tools follow jumped away from
 * where the user types for as long as the answer streamed.
 *
 * Pure: key presses and chunk-end cursor positions in, "hold the textarea
 * here" out. Lines are ABSOLUTE buffer lines, so scrolling does not move a
 * caret. Normal screen only; the caller releases on the alternate screen.
 */
export interface CaretPos {
  line: number
  x: number
}

export interface CaretHoldState {
  /** The caret the last keystroke produced, or null before any. */
  caret: CaretPos | null
  /** Until when positions still belong to the last keystroke. */
  windowUntil: number
}

/** How long after a key its echo may still arrive. */
export const KEY_WINDOW_MS = 250

export const initialCaretHold = (): CaretHoldState => ({ caret: null, windowUntil: 0 })

/** A key was pressed: what follows is its echo. */
export function onCaretKey(_s: CaretHoldState, now: number): CaretHoldState {
  // A fresh window; the caret is found again from what the key redraws.
  return { caret: null, windowUntil: now + KEY_WINDOW_MS }
}

/**
 * A write ended with the cursor at `at`. Returns the new state and where the
 * textarea must be HELD, or null when xterm's own placement stands.
 */
export function onCaretMove(s: CaretHoldState, at: CaretPos, now: number): { state: CaretHoldState; hold: CaretPos | null } {
  if (now <= s.windowUntil) {
    // The key's echo: the LOWEST position it reaches is the input line. A
    // streaming frame landing inside the window is above it and loses.
    const caret = !s.caret || at.line >= s.caret.line ? at : s.caret
    return { state: { ...s, caret }, hold: caret === at ? null : caret }
  }
  if (!s.caret) return { state: s, hold: null }
  // Above the caret: the program is drawing elsewhere on its own. Hold.
  if (at.line < s.caret.line) return { state: s, hold: s.caret }
  // At or below: a new prompt, or output that pushed the input down. Follow.
  return { state: { ...s, caret: at }, hold: null }
}

/** The alternate screen, a resize, a view scrolled back: forget the caret. */
export const releaseCaretHold = (): CaretHoldState => initialCaretHold()
