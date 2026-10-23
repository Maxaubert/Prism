import { decideInto, pasteOf, SEND_ENTER_MS, type SendDecision, type SendTab } from './orchestratorSend'
import { startLinkClient, type ClientHandlers, type RemoteCopy } from './dictationLink'

/**
 * JOINING THE ONE DICTATION (owner, 2026-10-17: "if it's a session from Prism,
 * it should have the header Prism above it"; spec: docs/superpowers/specs/
 * 2026-10-17-dictation-all-apps.md). Any app on the core joins the dictation a
 * Prism Terminal runs by giving four things: its tabs, what Windows says runs
 * under one, a way to write to a tab's shell, and a paste into its front tab.
 * The checks of typing into a tab live here, so every app keeps the same rule
 * (the rule 2 exception: into a running Claude only, never a shell).
 */

export interface DictationClientHost {
  /** The tabs now: label, folder, the agent's mark and state, the session. */
  tabs(): SendTab[]
  /** Whether this app's orchestrator switch is on. */
  orchestratorOn(): boolean
  /** What Windows says runs under a tab's shell ('claude', or not). */
  agentUnder(id: string): Promise<string | null>
  /** Write to a tab's shell. */
  writeTerm(id: string, data: string): void
  /** Paste dictated words at the cursor of the tab in front, never Enter. */
  paste(text: string): void
}

/**
 * TYPE INTO A TAB, CHECKED (shared by the orchestrator's sends and dictation).
 * `decide` names the tab and its limits (orchestratorSend); then:
 * - the tab's Claude mark is only what the tab's own output said, which a
 *   program printing the same signal would earn, so Windows' process tree is
 *   asked (security review, 2026-10-16);
 * - that takes about a second, in which the switch, the tab or its state can
 *   change: decided again, synchronously, right before typing, and the same
 *   tab and session must win;
 * - and once more before Enter: a question that opened in between would take
 *   the Enter as its answer. The text then waits, unsent.
 */
export async function typeChecked(
  decide: () => SendDecision,
  text: string,
  host: Pick<DictationClientHost, 'agentUnder' | 'writeTerm'>,
  later: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms)
): Promise<SendDecision> {
  let said = decide()
  if (said.ok && (await host.agentUnder(said.target.id)) !== 'claude')
    said = { ok: false, reason: `no Claude is running in ${said.target.label} (checked with Windows)` }
  if (said.ok) {
    const was = said.target
    const now = decide()
    said = now.ok && now.target.id === was.id && now.target.session === was.session ? now : { ok: false, reason: `${was.label} changed while it was checked: send again` }
  }
  if (said.ok) {
    const id = said.target.id
    host.writeTerm(id, pasteOf(text))
    later(() => {
      const still = decide()
      if (still.ok && still.target.id === id) host.writeTerm(id, '\r')
    }, SEND_ENTER_MS)
  }
  return said
}

/** The tabs as the dictation's list gets them: the orchestrator marked only
 *  when it is ACTIVE, switched on and its Claude really running per Windows. */
export async function publishTabs(tabs: SendTab[], on: boolean, agentUnder: (id: string) => Promise<string | null>): Promise<SendTab[]> {
  const lead = on ? tabs.find((t) => t.orchestrator) : undefined
  const active = !!lead && (await agentUnder(lead.id)) === 'claude'
  return tabs.map((t) => ({ ...t, orchestrator: active && t.id === lead!.id }))
}

/** What a client answers the service with, for this app. */
export function dictationAnswers(host: DictationClientHost): ClientHandlers {
  return {
    tabs: () => publishTabs(host.tabs(), host.orchestratorOn(), (id) => host.agentUnder(id)),
    send: (id, text) => typeChecked(() => decideInto(id, host.tabs()), text, host),
    paste: (text) => host.paste(text)
  }
}

/**
 * Join: connects to the service on `pipe` (dictationLink's `linkPipe` of the
 * user's `linkKey`), keeps trying while there is none, and says when it is
 * connected, which is when the app's own window should stop reading the
 * dictation key (`setDictationPageKeys(false)`): the service's hook reads it.
 */
export function startDictationClient(
  pipe: string,
  key: Buffer,
  me: RemoteCopy,
  host: DictationClientHost,
  onConnected?: (connected: boolean) => void
): { close(): void } {
  return startLinkClient(pipe, key, me, dictationAnswers(host), 1000, onConnected)
}
