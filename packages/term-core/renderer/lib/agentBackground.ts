/**
 * IS THE AGENT STILL WORKING IN THE BACKGROUND? (owner, 2026-10-16: "is it
 * possible for prism terminal to detect when claude code is running a e2e
 * test since that isnt flagged with the agent indicator as working", then of
 * a session waiting on a workflow: "this session doesnt say its working, even
 * though theres a workflow").
 *
 * Claude Code ends its turn (the Stop hook) while a shell it started with
 * run_in_background, or a workflow, keeps running, and nothing it sends the
 * terminal says so. Its SCREEN does, MEASURED (Claude Code 2.1.301
 * fullscreen, a `sleep 50` in the background; `agentBackground.screens.json`):
 * - the turn's summary line ends "· 1 shell still running", and is rewritten
 *   without it the moment the shell ends;
 * - the footer under the prompt's box says "· 1 shell" after the mode line,
 *   gone with it;
 * - a running workflow draws its progress row in the footer
 *   ("○ name ▬▬▬ 7/8 · 11m03s").
 * Only these LIVE marks count. The "✻ Waiting for 1 dynamic workflow to
 * finish" line stays in the conversation after the wait is over, so it is not
 * read.
 *
 * Claude's wording today: a rewording in a Claude update is a change here, and
 * until then the tab shows Finished as it did before. Pure: rows in, a verdict
 * out.
 */

/** A rule of the prompt's box: a long run of box-drawing dashes. */
const RULE = /^\s*─{20,}\s*$/

export function looksLikeBackgroundWork(rows: readonly string[]): boolean {
  // The turn's summary line, kept current by Claude: "· 1 shell still running".
  if (rows.some((r) => /·\s*\d+\s+(?:background\s+)?(?:shells?|tasks?|commands?)\s+still running\b/i.test(r))) return true
  // The footer: the rows under the prompt box's lower rule.
  let last = -1
  rows.forEach((r, i) => {
    if (RULE.test(r)) last = i
  })
  if (last < 0) return false
  for (const r of rows.slice(last + 1)) {
    // The mode line's count of background shells: "auto mode on · 1 shell".
    if (/·\s*\d+\s+(?:shells?|tasks?)\b/i.test(r)) return true
    // A running workflow's progress row: "7/8 · 11m03s".
    if (/\b\d+\/\d+\s+·\s+(?:\d+h)?(?:\d+m)?\d+s\b/.test(r)) return true
  }
  return false
}
