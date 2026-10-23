import type { DetectedAgent } from '../../shared/types'

/**
 * THE CLOSE QUESTION, one rule for both apps and NOT a setting (owner,
 * 2026-09-19: "remove the setting but just have it on smart mode by default,
 * so it won't ask if you're in a normal shell but if you're working with an
 * agent it will ask").
 *
 * It replaced two different settings: Prism's three modes (always / agent /
 * never) and Prism Terminal's on/off switch. A plain shell has nothing to
 * lose, so closing it never asks. A tab whose shell HOSTS an agent asks,
 * working or idle: an agent waiting at its own prompt is still a conversation
 * the close ends. Closing the WINDOW is held only while an agent is mid-answer,
 * because both apps bring idle agents back at the next launch.
 *
 * A host's OTHER reasons to ask (Prism's unsaved text) are its own and are
 * untouched by this.
 */

/** Closing this tab: ask first? */
export function asksBeforeClosingTab(agentPresent: boolean): boolean {
  return agentPresent
}

/** Closing the window: hold it and ask? */
export function holdsWindowClose(agentsWorking: number): boolean {
  return agentsWorking > 0
}

export const AGENT_NAMES: Record<DetectedAgent, string> = {
  claude: 'Claude',
  codex: 'Codex',
  other: 'The agent'
}

/** What the question says. `forMs` is how long the agent has been mid-answer,
 *  null when it is only present, waiting at its own prompt.
 *
 *  `install` (#28) is the window question by another door: installing an update
 *  ends in the app quitting, so it is held by the same rule (`holdsWindowClose`)
 *  and asked BEFORE the download. It says what it is about to do, because
 *  "close the window?" over an Install button is a question about something
 *  the user did not ask for. */
export function closeQuestionTitle(
  target: 'tab' | 'window' | 'install',
  forMs: number | null
): string {
  if (target === 'install') return 'Stop the agent and install the update?'
  if (target === 'window') return 'Stop the agent and close the window?'
  return forMs === null ? 'Close the tab and end the agent?' : 'Stop the agent and close?'
}
