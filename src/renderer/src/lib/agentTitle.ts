/**
 * What an agent says about itself through the terminal TITLE (2026-09-04).
 *
 * Claude Code writes its state into OSC 0, MEASURED on a real session:
 * "✳ Claude Code" at idle, a half-circle spinner glyph ("◐ Claude Code",
 * cycling ◐ ◑ ◒ ◓) from 30ms after Enter, held through tool calls, and back
 * to "✳ <task>" the instant the answer lands. That is the indicator's
 * signal: an event from the agent itself, with no output heuristic, no
 * sustain window and no polling in between. Codex sets no such title
 * (measured too), so a session that never says anything here keeps the
 * output-run fallback.
 */

const WORKING = new Set(['◐', '◑', '◒', '◓'])
const IDLE = '✳'

export type AgentTitleState = 'working' | 'idle'

/** The state a title carries, or null when the title is not an agent's. */
export function titleState(title: string): AgentTitleState | null {
  const first = [...title.trimStart()][0]
  if (!first) return null
  if (WORKING.has(first)) return 'working'
  if (first === IDLE) return 'idle'
  return null
}
