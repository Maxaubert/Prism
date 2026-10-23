// CLICK TO PUT THE CARET THERE (owner, 2026-09-22: "I'd like to be able to click
// anywhere in my text in the terminal, like click inside the text to put the
// caret there"). A terminal has no caret of its own to place: the shell owns
// the line being edited. So a click is turned into the Left or Right presses
// that would walk the shell's cursor to the cell clicked, which every line
// editor understands (PSReadLine, cmd, readline, an agent's input box).
//
// Pure, so every rule is tested without a terminal. The panel reads the buffer
// and the event into these shapes and sends what `arrowKeys` returns.

export type MouseTracking = 'none' | 'x10' | 'vt200' | 'drag' | 'any'

/** Everything that decides whether a click may move the caret at all. */
export interface ClickGate {
  /** The mouse button; only the primary button places the caret. */
  button: number
  /** 2 or more is a double or triple click, which selects a word or line. */
  detail: number
  /** Shift extends a selection, Alt is xterm's own column select and
   *  move-to-cell, Ctrl and Meta belong to links and the host. */
  modifiers: boolean
  /** The pointer travelled between press and release, or text is selected. */
  dragged: boolean
  /** The program asked for the mouse (a TUI): the click is its to read. */
  mouseTracking: MouseTracking
  /** A full-screen program's own screen: there is no line being edited. */
  alternate: boolean
  /** The view is scrolled back into history, away from the cursor. */
  scrolledBack: boolean
  /** The program hid the cursor, so the cursor is not where it edits. */
  cursorHidden: boolean
  /** Something is printed below the cursor's line: a program is running and
   *  writing, not a prompt waiting for input. */
  textBelow: boolean
  /** The click is outside the line holding the cursor. */
  offLine: boolean
  /** The click landed on a link, which opens instead. */
  onLink: boolean
}

export function caretClickAllowed(g: ClickGate): boolean {
  return (
    g.button === 0 &&
    g.detail < 2 &&
    !g.modifiers &&
    !g.dragged &&
    g.mouseTracking === 'none' &&
    !g.alternate &&
    !g.scrolledBack &&
    !g.cursorHidden &&
    !g.textBelow &&
    !g.offLine &&
    !g.onLink
  )
}

/**
 * How many characters to move, positive for Right and negative for Left.
 *
 * `widths` are the cells of the cursor's LOGICAL line, row after row across its
 * wraps, each 1, or 2 for a wide character (CJK, most emoji) whose second cell
 * is 0. `cursor` and `target` are cell offsets into it; `textEnd` is the offset
 * just past the last printed cell. Wide characters count once, which is what a
 * line editor moves by. A click past the end of the text lands at the end (or
 * where the cursor already is, when trailing spaces put it further), so a
 * click in the empty space to the right is "go to the end", not a run of
 * presses into nothing.
 */
export function caretDelta(widths: readonly number[], cursor: number, target: number, textEnd: number): number {
  const start = (i: number): number => {
    let j = Math.max(0, i)
    while (j > 0 && widths[j] === 0) j -= 1
    return j
  }
  const from = start(cursor)
  const to = start(Math.min(target, Math.max(textEnd, cursor)))
  if (from === to) return 0
  const [a, b] = from < to ? [from, to] : [to, from]
  let n = 0
  for (let i = a; i < b; i += 1) if ((widths[i] ?? 1) !== 0) n += 1
  return from < to ? n : -n
}

/** The presses for `delta`: Right or Left, in the application form (ESC O)
 *  when the program switched cursor keys to it, as vim and some shells do. */
export function arrowKeys(delta: number, applicationCursor: boolean): string {
  if (!delta) return ''
  const key = applicationCursor ? (delta > 0 ? '\x1bOC' : '\x1bOD') : delta > 0 ? '\x1b[C' : '\x1b[D'
  return key.repeat(Math.abs(delta))
}
