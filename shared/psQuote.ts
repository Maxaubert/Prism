/**
 * A string as a PowerShell single-quoted literal: nothing inside expands, and a
 * quote inside is doubled. PowerShell counts the curly quotes (‘ ’ ‚ ‛) as
 * quotes too, so they are doubled as well: a folder named O’Brien otherwise
 * ends the literal early (audit 2026-10-12: the update handoff doubled only the
 * plain one, and its restart broke on such a path). The one rule for every
 * place either app writes PowerShell.
 */
export function psQuote(s: string): string {
  return `'${s.replace(/['‘’‚‛]/g, '$&$&')}'`
}
