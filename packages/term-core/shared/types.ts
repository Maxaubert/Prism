// The types the terminal itself speaks. Owned by the core, so a host (Prism,
// Prism Terminal) imports them from here and the two can never disagree about
// what a shell or an agent is.

/** A shell main detected on this machine; the only things term:spawn launches. */
export interface ShellDef {
  id: string
  name: string
  exe: string
  args: string[]
}

/** The agents whose conversation can be resumed at the next launch, each by
 *  its own flag: `claude --resume <id>` and `codex resume --last`. THE ONE LIST
 *  (audit 2026-10-12: three inline unions, a second alias and three
 *  hand-written checks named them, so a third resumable agent would have been
 *  dropped from saved tabs without a word). */
export const RESUMABLE_AGENTS = ['claude', 'codex'] as const

export type AgentKind = (typeof RESUMABLE_AGENTS)[number]

/** Can this agent's conversation come back at the next launch? */
export function isResumable(kind: unknown): kind is AgentKind {
  return (RESUMABLE_AGENTS as readonly unknown[]).includes(kind)
}

/** What the process poll can find in a shell. 'other' agents (aider, gemini)
 *  light the indicator but have nothing to come back to. */
export type DetectedAgent = AgentKind | 'other'

/** Which bundled Claude Code plugins a new shell is given (2026-10-16): the
 *  status one (#131) and the opt-in orchestrator. */
export interface PluginChoice {
  status: boolean
  orchestrator: boolean
}
