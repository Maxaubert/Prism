/**
 * IS THE AGENT WAITING ON YOU? (2026-09-28; owner: "when a session asks you a
 * question ... the working indicator stops, but you don't really know if it's
 * finished or if there's a question").
 *
 * Claude Code says nothing to the terminal about it. MEASURED, a real session
 * in a pty asked to use its question tool: the title went `◐ …` then `✳ …`
 * and stayed `✳` while it waited, exactly as it does when it has finished; no
 * bell, no OSC 9, no progress sequence. What differs is the SCREEN: the
 * question box draws its footer, "Enter to select · ↑/↓ to navigate · Esc to
 * cancel", and a permission prompt asks "Do you want to …?" over numbered
 * choices ("1. Yes"). So this reads the bottom rows of the screen at the
 * moment the title goes idle, and again as output arrives while it stays so.
 *
 * Claude's wording today. A rewording in a Claude update is a change here,
 * and until then the tab shows Finished where it would have shown Question.
 * Pure: rows of text in, a verdict out.
 */
export function looksLikeQuestion(rows: readonly string[]): boolean {
  const text = rows.join('\n')
  // The question tool's footer.
  if (/Enter to select/i.test(text) && /Esc to cancel/i.test(text)) return true
  // A permission prompt: the question and its first, numbered answer.
  if (/Do you want to [^\n]*\?/i.test(text) && /(^|\s)1\.\s+Yes\b/m.test(text)) return true
  return false
}

/**
 * A QUESTION LASTS UNTIL IT IS ANSWERED (#144; owner, 2026-10-09: "if you go on
 * that tab and then just move to another tab without answering the question,
 * the blue bar shouldn't disappear ... it should only disappear if you actually
 * answered the question"). Most answers say so themselves: a yes is work again
 * (a working hook or title). Turning a permission prompt down, or cancelling a
 * question with Esc, ends the turn with no hook at all (no Stop fires on an
 * interrupt, MEASURED for #131), so the keys that settle a box are heard too:
 * Enter, Esc, Ctrl+C and a numbered choice. Walking the choices is not one.
 */
export function answersQuestion(key: string): boolean {
  return key === '\r' || key === '\x1b' || key === '\x03' || /^[1-9]$/.test(key)
}

/** A key that settles a box, with the box gone from the screen after it. A box
 *  still up is the next of several questions, still waiting. */
export function questionAnswered(key: string, rows: readonly string[]): boolean {
  return answersQuestion(key) && !looksLikeQuestion(rows)
}
