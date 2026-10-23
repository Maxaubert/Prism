// BACKSPACE DELETES WHAT IS SELECTED (owner, 2026-09-23: "i should also be able
// to highlight text and use backspace to delete the selected text"). As with a
// click on the line (`termClickCaret`), the shell owns the line being edited,
// so the delete is turned into the presses that would do it by hand: walk the
// cursor to the END of the selection, then one Backspace per character. Every
// line editor understands both (PSReadLine, cmd, readline, an agent's input).
//
// And WHAT IS UNDER THE POINTER, for the right-click menu (same day: "if i
// click it on a link it shows copy link, if i click it with text marked it
// says copy"). Pure, so every rule is tested without a terminal.

import { arrowKeys, caretDelta, type MouseTracking } from './termClickCaret'
import { findLinks } from './termLinks'

/** Everything that decides whether Backspace may delete the selection. */
export interface SelectionGate {
  /** The program asked for the mouse (a TUI): the selection is not ours. */
  mouseTracking: MouseTracking
  /** A full-screen program's own screen: there is no line being edited. */
  alternate: boolean
  /** The view is scrolled back into history, away from the cursor. */
  scrolledBack: boolean
  /** The program hid the cursor, so the cursor is not where it edits. */
  cursorHidden: boolean
  /** Something is printed below the cursor's line: a program is running. */
  textBelow: boolean
  /** The selection starts and ends on the line holding the cursor. */
  onLine: boolean
}

export function selectionDeleteAllowed(g: SelectionGate): boolean {
  return (
    g.mouseTracking === 'none' &&
    !g.alternate &&
    !g.scrolledBack &&
    !g.cursorHidden &&
    !g.textBelow &&
    g.onLine
  )
}

/**
 * The presses that delete cells `[start, end)` of the cursor's logical line:
 * Left or Right to the end of the selection, then a Backspace (DEL, 0x7f) per
 * character in it. `widths`, `cursor` and `textEnd` are `caretDelta`'s. A
 * selection running past the text stops at its end, so trailing blank cells
 * delete nothing; wide characters count once, which is what a line editor
 * deletes by. Empty when there is nothing to delete.
 */
export function selectionDeleteKeys(
  widths: readonly number[],
  cursor: number,
  start: number,
  end: number,
  textEnd: number,
  applicationCursor: boolean
): string {
  const to = Math.min(Math.max(start, end), textEnd)
  const from = Math.min(start, end)
  let count = 0
  for (let i = from; i < to; i += 1) if ((widths[i] ?? 1) !== 0) count += 1
  if (!count) return ''
  return arrowKeys(caretDelta(widths, cursor, to, textEnd), applicationCursor) + '\x7f'.repeat(count)
}

/** The link covering character `at` of a logical line's text, or null. A link
 *  the line wraps keeps its whole text, since `text` is the joined rows. */
export function linkAt(text: string, at: number): string | null {
  const hit = findLinks(text).find((l) => at >= l.start && at < l.end)
  return hit ? text.slice(hit.start, hit.end) : null
}
