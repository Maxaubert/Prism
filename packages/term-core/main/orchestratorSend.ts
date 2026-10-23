import { sanitizePaste } from '../renderer/lib/termPaste'

/**
 * THE ORCHESTRATOR SENDS INTO ANY TAB (owner, 2026-10-16: "the terminal needs
 * to be able to send it, and it needs to be able to send it to any session,
 * not just whichever is in focus. That is very important."). An owner
 * exception to rule 2 (docs/regression-rules.md#only-command-is-resume): the
 * app types a message into another tab's Claude Code prompt, and nowhere else.
 *
 * Pure: which tab a request names, and whether it may be typed there. The
 * request comes from the orchestrator's script through a file main reads
 * (sessionsWire); what is typed is built here.
 */

export interface SendTab {
  /** The pty session id. */
  id: string
  /** Its shell's PRISM_TAB_ID. */
  tab: string
  label: string
  cwd: string
  agent: string | null
  state: string | null
  orchestrator: boolean
  session: string | null
}

export interface SendRequest {
  /** The asking shell's PRISM_TAB_ID. */
  from: string
  /** A tab's PRISM_TAB_ID, its Claude session id, its label, or a word of its label or folder. */
  to: string
  text: string
}

export type SendDecision = { ok: true; target: SendTab } | { ok: false; reason: string }

/** Long enough for any instruction; a paste this size is not a message. */
export const SEND_MAX = 8000

export function decideSend(req: SendRequest, tabs: readonly SendTab[], enabled: boolean): SendDecision {
  if (!enabled) return { ok: false, reason: 'the orchestrator is switched off in Settings' }
  const lead = tabs.find((t) => t.orchestrator)
  // Only the promoted tab may send (a same-user program could forge this; it
  // could also type into any window, so the check is about mistakes, not a
  // boundary).
  if (!lead || !req.from || req.from !== lead.tab) return { ok: false, reason: 'only the orchestrator tab can send' }
  const text = typeof req.text === 'string' ? req.text.trim() : ''
  if (!text) return { ok: false, reason: 'the message is empty' }
  if (text.length > SEND_MAX) return { ok: false, reason: `the message is over ${SEND_MAX} characters` }
  const to = (req.to ?? '').trim()
  if (!to) return { ok: false, reason: 'no tab named' }
  const others = tabs.filter((t) => t !== lead)
  const low = to.toLowerCase()
  // A tab's own ids first (what -List prints, and the skill sends); then its
  // exact label; a word of a label or folder only when nothing else matched,
  // and never when it names more than one (security review, 2026-10-16: a
  // folder named after another tab must not take its messages).
  const ids = others.filter((t) => t.tab === to || t.session === to)
  const exact = others.filter((t) => t.label.toLowerCase() === low)
  const loose = others.filter((t) => t.label.toLowerCase().includes(low) || t.cwd.toLowerCase().includes(low))
  const hits = ids.length ? ids : exact.length ? exact : loose
  if (hits.length === 0) return { ok: false, reason: `no tab matches "${to}"` }
  if (hits.length > 1) return { ok: false, reason: `"${to}" matches ${hits.map((t) => t.label).join(', ')}: name one` }
  return typeable(hits[0])
}

/** Whether the app may type into this tab at all (the rule 2 exception's
 *  limits, shared by the orchestrator and dictation). */
export function typeable(target: SendTab): SendDecision {
  // Only into a Claude Code prompt: never into a shell, where the text would
  // run as a command.
  if (target.agent !== 'claude' || !target.session) return { ok: false, reason: `${target.label} has no Claude session running` }
  // A question or permission box would take the text as its answer.
  if (target.state === 'question') return { ok: false, reason: `${target.label} is waiting on a question: answer it there first` }
  return { ok: true, target }
}

/**
 * DICTATION FROM OUTSIDE THE APP (owner, 2026-10-16): the tab the owner picked
 * by its pty id, with the same limits.
 */
export function decideInto(id: string, tabs: readonly SendTab[]): SendDecision {
  const target = tabs.find((t) => t.id === id)
  if (!target) return { ok: false, reason: 'that tab has closed' }
  return typeable(target)
}

/**
 * Where dictated text goes (owner: with the orchestrator "only if the
 * orchestrator is actually active not just that you have the setting turned
 * on"): the promoted tab when the switch is on and its Claude can take it;
 * else the tabs a Claude can take it in, to pick from, the orchestrator first.
 * Windows' process check confirms the lead before anything is typed.
 */
export function dictationRoute(tabs: readonly SendTab[], enabled: boolean): { lead: SendTab } | { pick: SendTab[] } {
  const lead = enabled ? tabs.find((t) => t.orchestrator) : undefined
  if (lead && typeable(lead).ok) return { lead }
  const pick = tabs.filter((t) => t.agent === 'claude' && t.session)
  return { pick: [...pick.filter((t) => t.orchestrator), ...pick.filter((t) => !t.orchestrator)].slice(0, 9) }
}

/**
 * What is typed: the message as ONE bracketed paste (MEASURED, Claude Code
 * 2.1.301: a multi-line paste is one prompt), every escape and control but
 * tab and newline taken out (rule 1, `sanitizePaste`), then Enter on its own
 * after `SEND_ENTER_MS` (the measured sequence that submits).
 */
export const SEND_ENTER_MS = 300
export function pasteOf(text: string): string {
  const clean = sanitizePaste(text.replace(/\r\n?/g, '\n'))
  return `\x1b[200~${clean}\x1b[201~`
}
