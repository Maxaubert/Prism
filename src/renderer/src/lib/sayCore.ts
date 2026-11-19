import { logNote, noteLevel, type NoteLevel } from './noteLog'

/**
 * THE WORDS AND TIMES OF EVERY NOTICE (#517, owner 2026-11-19). A job that
 * failed or finished used to speak four ways (a dialog, a 2 s toast, a 5 s
 * chip line, a black pill), each with its own hand-set time and its own
 * title. The times and the title live here, once; `say()` (lib/say.ts) is the
 * one way to speak, and `logSaid` is the one place that writes the note to the
 * diagnostics log (owner, 2026-11-06: every note is logged).
 */

/** A quick action's toast ("Image copied", "Undid moving a.txt"). */
export const TOAST_MS = 1800
/** A toast that says something did not work stays a little longer. */
export const TOAST_LONG_MS = 2600
/** How long a done note stays on the job chip ("Saved 37 copies, 2 could not
 *  be read"). Long enough to read a line. */
export const NOTE_MS = 5000

/** The title of the one dialog for an error. */
export const SAY_TITLE = "That didn't work"

export type SayKind = 'toast' | 'chip' | 'dialog'
export type SayOpts = { op?: string; level?: NoteLevel; kind?: SayKind }

/** How long a toast of this level shows. */
export function toastMs(level: NoteLevel): number {
  return level === 'info' ? TOAST_MS : TOAST_LONG_MS
}

/** Write a note the user is being shown to the diagnostics log, once. */
export function logSaid(text: string, ctx: { op?: string; title?: string; level?: NoteLevel } = {}): NoteLevel {
  const level = ctx.level ?? noteLevel(text)
  logNote(text, { ...ctx, level })
  return level
}