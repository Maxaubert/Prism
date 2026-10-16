/**
 * CLAUDE CODE'S QUESTION WIDGET, READ OFF THE SCREEN (Sonara #323).
 *
 * Claude Code shows the questions of one AskUserQuestion one at a time and
 * tells plugins nothing until all are answered, so Sonara (the text-to-speech
 * reader) cannot follow the user from question to question. The screen can:
 * under the tab row (`←  ☐ Colour  ☒ Size  ✔ Submit  →`) stands the full text
 * of the question showing, a long one wrapped over lines that start with `│`.
 * It changes on the arrows, Tab and an answer, and not while an answer is
 * typed. After the last question the widget reads "Review your answers".
 *
 * MEASURED (2026-10-16, Claude Code 2.1.301, 120 and 70 columns, one-line,
 * wrapped and multi-select questions); the fixtures are those screens.
 */

import type { ShownQuestion } from '../shared/questionShown'

export type { ShownQuestion }

/** The tab row: the arrows around the tabs, the last one Submit. */
const TAB_ROW = /^\s*←.*✔\s*Submit\s*→\s*$/
/** The first option ends the question: `❯ 1. Red`, `  2. [ ] Linux`. */
const OPTION = /^\s*(?:❯\s*)?\d+\.\s/
/** The widget's last line while a question shows. */
const HINT = /^\s*Enter to select/
const REVIEW = /^\s*Review your answers\s*$/

/**
 * The question the widget shows on these screen rows (the visible ones,
 * top to bottom), or null when no question widget is on them.
 */
export function extractQuestion(rows: readonly string[]): ShownQuestion | null {
  const tab = rows.findIndex((r) => TAB_ROW.test(r))
  if (tab < 0) return null
  const rest = rows.slice(tab + 1)
  if (rest.some((r) => REVIEW.test(r))) return { review: true }
  if (!rest.some((r) => HINT.test(r))) return null
  const lines: string[] = []
  for (const row of rest) {
    if (OPTION.test(row)) break
    const line = row.replace(/^\s*│\s?/, '').trim()
    if (line) lines.push(line)
  }
  const text = lines.join(' ').replace(/\s+/g, ' ').trim()
  return text ? { text } : null
}

/** Two extracts are the same question (or both the review). */
export function sameQuestion(a: ShownQuestion | null, b: ShownQuestion | null): boolean {
  if (!a || !b) return a === b
  if ('review' in a || 'review' in b) return 'review' in a && 'review' in b
  return a.text === b.text
}
