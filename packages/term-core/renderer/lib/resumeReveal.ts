import type { AgentKind } from '../../shared/types'
/**
 * WHEN A RESUMING TAB SHOWS ITS TERMINAL (#106; spec
 * docs/superpowers/specs/2026-09-30-launch-skeleton-design.md). A tab coming
 * back to Claude or Codex wears a skeleton of the agent's layout until the
 * agent has drawn itself, and the shell's own words (its prompt, the resume
 * command) are cleared before the agent draws a cell, so they are never seen.
 *
 * MEASURED 2026-09-30, pwsh starting `claude` as its startup command through
 * the bundled ConPTY: the first console title is exactly `claude` (3.6 s),
 * preceded only by terminal setup; then Claude's own `✳ Claude Code` (5.4 s),
 * and the switch to the alternate screen 35 ms after it.
 *
 * So: CLEAR just before the title that names the agent; REVEAL once the agent
 * has painted, which is the next title that differs from its bare name, or a
 * switch to the alternate screen, each given a moment to land; or at once on
 * a key (the user sees what they type), an exit or a failed spawn; or at a
 * ceiling, whatever is there. Pure: the panel feeds it and keeps the clock.
 */
export interface RevealState {
  agent: AgentKind
  startedAt: number
  /** The shell's words are gone: the clear has been written. */
  cleared: boolean
  /** When the agent's paint counts as landed, once it has begun. */
  settleAt: number | null
  revealed: boolean
}

/** A paint is given this long to land before the skeleton lifts. */
export const SETTLE_MS = 150
/** Past this, the terminal is shown whatever it holds. */
export const CEILING_MS = 12_000

/** The clear written to xterm alone: screen, scrollback, home. */
export const CLEAR = '\x1b[2J\x1b[3J\x1b[H'

export function agentOfResume(resume: string): AgentKind {
  return resume.startsWith('codex') ? 'codex' : 'claude'
}

export const startReveal = (agent: AgentKind, now: number): RevealState => ({
  agent,
  startedAt: now,
  cleared: false,
  settleAt: null,
  revealed: false
})

// An OSC 0 or 2 title, ended by BEL or ST: control characters are the point.
// eslint-disable-next-line no-control-regex
const TITLE = /\x1b\](?:0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)/g

/** Does this title name the agent's program itself (`claude`, `claude.exe`,
 *  a full path to either)? Not a command line that merely mentions it. */
export function namesAgent(title: string, agent: AgentKind): boolean {
  const t = title.trim().toLowerCase()
  // A bare name is the program; a PATH is the program only when it ends in
  // the exe, since a shell's title can be a folder, and the owner's own
  // projects live under a folder called Claude.
  if (!/[\\/]/.test(t)) return t === agent || t === `${agent}.exe`
  return (t.split(/[\\/]/).pop() ?? '') === `${agent}.exe`
}

/**
 * A chunk of pty output arrives. Answers where to write the clear, as an
 * offset into `data` (-1 for nowhere), and whether the agent began to paint in
 * it. Call `painted` with the answer's `painting` to start the settle.
 */
export function onChunk(
  s: RevealState,
  data: string,
  now: number
): { state: RevealState; clearAt: number } {
  if (s.revealed) return { state: s, clearAt: -1 }
  let state = s
  let clearAt = -1
  for (const m of data.matchAll(TITLE)) {
    const title = m[1]
    if (!state.cleared) {
      if (namesAgent(title, state.agent)) {
        clearAt = m.index ?? 0
        state = { ...state, cleared: true }
      }
      continue
    }
    // After the bare name, the agent's own title: it is drawing.
    if (!namesAgent(title, state.agent) && state.settleAt === null) state = { ...state, settleAt: now + SETTLE_MS }
  }
  return { state, clearAt }
}

/** The terminal went to the alternate screen: a full-screen agent draws there. */
export function onAlternate(s: RevealState, now: number): RevealState {
  if (s.revealed || s.settleAt !== null) return s
  return { ...s, settleAt: now + SETTLE_MS }
}

/** Show the terminal NOW: a key, an exit, a failed spawn. */
export const revealNow = (s: RevealState): RevealState => (s.revealed ? s : { ...s, revealed: true })

/** The clock: the settle has passed, or the ceiling. */
export function onTick(s: RevealState, now: number): RevealState {
  if (s.revealed) return s
  if ((s.settleAt !== null && now >= s.settleAt) || now - s.startedAt >= CEILING_MS) return { ...s, revealed: true }
  return s
}
