import { record } from 'prism-term-core/renderer/lib/diag'

/**
 * EVERY NOTE THE USER IS SHOWN IS IN THE LOG (owner, 2026-11-06: "first i
 * got the that didnt work, then it worked. make sure logs are always on so
 * you can see what happened"). The owner saw "That didn't work" and the log
 * could not say what it said. A `note` line now holds the exact text, the
 * operation it came from when the caller knows it (`paste`, `rename`...), the
 * dialog's title, and how bad it is: `error` for a "That didn't work" or an
 * archive notice, `warn` for a done note that says something failed, `info`
 * for one that only reports. `npm run diag` lists error and warn notes as
 * problems, with the `op` lines just before them.
 */

export type NoteLevel = 'error' | 'warn' | 'info'

const MAX_TEXT = 1000
const FAILED = /could ?n[o']t|couldn't|cannot|can't|failed|not available|no files|nothing|didn't|refused|not there|in use|is gone/i

/** A done note that says something did not work is a warning. */
export function noteLevel(text: string): NoteLevel {
  return FAILED.test(text) ? 'warn' : 'info'
}

export function noteLine(
  text: string,
  ctx: { op?: string; title?: string; level?: NoteLevel } = {}
): { text: string; op?: string; title?: string; level: NoteLevel } {
  return {
    text: String(text ?? '').slice(0, MAX_TEXT),
    ...(ctx.op ? { op: ctx.op } : {}),
    ...(ctx.title ? { title: ctx.title } : {}),
    level: ctx.level ?? noteLevel(String(text ?? ''))
  }
}

/** Log a note the user is being shown. Never throws. */
export function logNote(text: string, ctx: { op?: string; title?: string; level?: NoteLevel } = {}): void {
  try {
    record('note', noteLine(text, ctx))
  } catch {
    /* the log never breaks the page */
  }
}
