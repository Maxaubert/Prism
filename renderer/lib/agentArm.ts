import type { DetectedAgent } from '../../shared/types'
import { titleAgent, titleArmsAgent } from './agentTitle'

/**
 * WHETHER AN AGENT RUNS IN A SHELL, AND WHICH, for the keys that change with
 * it: Shift+Enter's newline and an image's paste key (`termPaste`), and for
 * the theme reports it asked for (`gone`). Four voices, pure so the rules are
 * tested (review 2026-10-11 for the last three rules):
 *
 * - The RESUME arms it from the tab's first moment. The poll's first answer
 *   can be taken before the agent started, so a first "no agent" only asks
 *   the poll again (`recheck`); a second one takes it back.
 * - The TITLE arms it before the poll (#175): the poll's first verdict comes
 *   2.5 s at the earliest, and until then Shift+Enter SUBMITTED a half-written
 *   message. Only what `titleArmsAgent` takes as proof arms it. An agent only
 *   the title vouches for goes when the title stops naming it: in a WSL tab
 *   the poll sees wsl.exe and bash prints no prompt report, so nothing else
 *   would ever say it left.
 * - The POLL says when an agent arrives or leaves (#73); a wrapper ('other')
 *   does not undo the title's claude or codex. Its "no agent" takes back only
 *   what it saw itself.
 * - The shell's PROMPT report (OSC 9;9) proves nothing runs in front of it,
 *   and takes everything back at once. An agent the poll saw is still
 *   "present" to the poll, which says only what changed, so the poll is asked
 *   for its next answer whatever it is: a Codex started again before the next
 *   look is armed again.
 */
export interface AgentArm {
  here: boolean
  kind: DetectedAgent | null
  /** The poll's last word was "present": an agent it saw is its to take back. */
  polled: boolean
  /** The title vouches for it; for Codex, `rest` is its title at rest. */
  titled: boolean
  rest: string
  /** A resume's agent the poll has said "no agent" about once. */
  doubted: boolean
}

/** One move. `gone`: an agent known to be here has left, and whatever it
 *  asked the terminal for (theme reports) goes with it. `recheck`: ask the
 *  poll for its next answer for this session, changed or not. */
export interface ArmStep {
  arm: AgentArm
  gone: boolean
  recheck: boolean
}

const BARE: AgentArm = { here: false, kind: null, polled: false, titled: false, rest: '', doubted: false }
const step = (arm: AgentArm, gone = false, recheck = false): ArmStep => ({ arm, gone, recheck })

export const armAtStart = (resumed: DetectedAgent | null): AgentArm =>
  resumed ? { ...BARE, here: true, kind: resumed } : BARE

/** Codex asking names the folder its title returns to at rest (#131). */
const ASK_REST = /Action Required\s*\|\s*(.*)$/

/** Whether `title` is still the title-armed agent's own. */
function stillNames(s: AgentArm, title: string): boolean {
  const t = title.trim()
  const named = titleAgent(t)
  if (s.kind === 'claude') return named === 'claude'
  // Codex: asking, busy (its braille spinner before the folder) or at rest.
  if (s.kind === 'codex') return named === 'codex' || (s.rest !== '' && t === s.rest)
  return false
}

export function armOnTitle(s: AgentArm, title: string): ArmStep {
  const named = titleArmsAgent(title)
  if (named) {
    const rest = named === 'codex' ? (ASK_REST.exec(title.trim())?.[1]?.trim() ?? s.rest) : ''
    return step({ ...s, here: true, kind: named, titled: true, rest, doubted: false })
  }
  if (!s.titled || stillNames(s, title)) return step(s)
  // The poll saw it: the poll says when it leaves, whatever the title does.
  if (s.polled) return step({ ...s, titled: false })
  return step(BARE, true)
}

export function armOnPoll(s: AgentArm, present: boolean, kind: DetectedAgent | null): ArmStep {
  if (present) {
    return step({ ...s, here: true, kind: kind === 'other' && s.kind ? s.kind : kind, polled: true, doubted: false })
  }
  if (s.polled) return step(BARE, true)
  // The poll never saw the title's agent (WSL): its "no" is not about it.
  if (s.titled) return step(s)
  if (s.here && !s.doubted) return step({ ...s, doubted: true }, false, true)
  return step(BARE)
}

export function armOnPrompt(s: AgentArm): ArmStep {
  // Gone even with nothing armed: a program that died without its ?2031l
  // left reports on, and a push would reach the shell (PSReadLine reads the
  // ESC as RevertLine).
  return step(BARE, true, s.polled)
}
