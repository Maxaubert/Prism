import type { AgentSignal } from './agentHookSignal'

/**
 * THE INDICATOR'S RULES FOR A SESSION THAT SPEAKS THROUGH HOOKS (#131). Pure:
 * the hook (`useAgentIndicator`) keeps one phase per session and asks this what
 * a signal, or an idle title, does to it.
 *
 * A hook is the agent's own word, above its title: the title cannot tell a
 * permission prompt from a finished answer (both show the idle star, MEASURED)
 * and a failed turn looks finished. Two things are still the title's:
 * - AN ESC. No hook fires on an interrupt (MEASURED: no Stop, no StopFailure;
 *   the idle title came 72 ms after the Esc). So an idle title while the hooks
 *   last said `working` is an interrupt: the tab stops working and shows no
 *   Finished line, since an Esc is not a finish. A Stop that arrives after the
 *   idle title (the two race) still raises Finished.
 * - THE WORK A YES APPROVED (#148). After a permission prompt is answered no
 *   hook fires until the tool ENDS (MEASURED, Claude Code 2.1.296: PostToolUse
 *   26 s after Yes for a 25 s sleep), but the spinner title is back 34 ms after
 *   the key and repeats about every 960 ms. So a spinner after a question, or
 *   after an Esc's stop, is Working. Not the answer key: Enter on "2. No" is the
 *   same key as Enter on "1. Yes", and after a No or an Esc the title stays idle.
 * - WORK THAT GOES ON AFTER A STOP (#149). Background subagents keep running
 *   when the main turn's Stop fires, and Finished went up under them. The hook
 *   cannot say it (a subagent's hooks write the same signal), but the title
 *   does (MEASURED, case G2, Claude Code 2.1.296): after a lone Stop the idle
 *   star follows in 18 to 84 ms; with subagents still at work the spinner
 *   carries on, and the star comes only when the last of them ends. So a Stop
 *   while the title spins is `ending`, decided by the next title: the star is
 *   the finish, another spinner frame is `background` work, still Working,
 *   finished by the star that ends it. No title in 1.5 s (`settle`, longer than
 *   the spinner's 960 ms frame) finishes it as before.
 * - Whether an agent is there at all stays the process poll's.
 *
 * Finished and Failed are RAISED only on a tab nobody is looking at; the hook
 * decides that. A question goes up on any tab (`raisedWhileSeen`).
 * Question outranks Failed, which outranks Finished (the strip draws one).
 */

export type HookPhase = 'working' | 'question' | 'done' | 'failed' | 'stopped' | 'ending' | 'background'
export type AttentionMark = 'finished' | 'question' | 'failed'

export interface HookSession {
  phase: HookPhase
  /** The failure's kind, while the phase is `failed`. */
  kind?: string
}

export interface HookOutcome extends HookSession {
  working: boolean
  /** Marks this step puts on a tab nobody is looking at. */
  raise: AttentionMark[]
  /** Marks this step takes down, looking or not. */
  clear: AttentionMark[]
}

export type HookEvent = AgentSignal | { state: 'idle-title' } | { state: 'working-title' } | { state: 'settle' }

/** How long a Stop with the spinner still up waits for the next title before
 *  it is a plain finish: past one spinner frame (about 960 ms, MEASURED). */
export const STOP_SETTLE_MS = 1500

/** What the screen showed when the step was taken (`screenDecides` says when it is read). */
export interface HookSeen {
  /** Claude's question or permission box is on screen (`looksLikeQuestion`). */
  questionOnScreen?: boolean
  /** The session's title last said working (a spinner), when a Stop arrives. */
  titleWorking?: boolean
}

/** What one event does, or null when it changes nothing. */
export function hookStep(prev: HookSession | undefined, ev: HookEvent, seen?: HookSeen): HookOutcome | null {
  // WHILE THE BOX IS ON SCREEN, THE QUESTION STANDS (#148). Subagents' hooks
  // write the same signal as the main agent's, so a sibling's tool call or the
  // main turn's Stop took a pending question down 1 to 4 s after it went up
  // (MEASURED, case G2: up for 3.9 s of the 14 s the box waited). The box is
  // drawn before the question signal and repainted away after the answer, so
  // it brackets the wait exactly, whoever drew it.
  if (seen?.questionOnScreen && screenDecides(prev, ev)) {
    // Finished goes up under the question (which outranks it), so a No to the
    // box still leaves the finish the main turn made.
    if (ev.state === 'done') return { phase: 'question', working: false, raise: ['finished'], clear: [] }
    return null
  }
  const finish: HookOutcome = { phase: 'done', working: false, raise: ['finished'], clear: ['question', 'failed'] }
  switch (ev.state) {
    case 'working-title':
      // After a Stop with the spinner up, another frame is work still going
      // on: background subagents (#149).
      if (prev?.phase === 'ending') return { phase: 'background', working: true, raise: [], clear: [] }
      // Not after a finish or a failure: a new turn always says
      // UserPromptSubmit first, and a stray frame must not relight it.
      if (prev?.phase !== 'question' && prev?.phase !== 'stopped') return null
      return { phase: 'working', working: true, raise: [], clear: ['question'] }
    case 'idle-title':
      // The star after a Stop, or after the background work it left: the turn
      // is over now (#149).
      if (prev?.phase === 'ending' || prev?.phase === 'background') return finish
      // Otherwise only an interrupt is the title's to say; after a question, a
      // finish or a failure the idle title is just the agent at rest.
      if (prev?.phase !== 'working') return null
      return { phase: 'stopped', working: false, raise: [], clear: [] }
    case 'settle':
      // No title came after the Stop: a plain finish, as before #149.
      return prev?.phase === 'ending' ? finish : null
    case 'working':
      // A new prompt, a tool call, a subagent: whatever was waiting is over.
      return { phase: 'working', working: true, raise: [], clear: ['question', 'failed', 'finished'] }
    case 'question':
      return { phase: 'question', working: false, raise: ['question'], clear: ['failed'] }
    case 'done':
      // The spinner still up: the next title decides (#149). Working holds
      // meanwhile, so a lone Stop's ring does not blink off and on.
      if (seen?.titleWorking) return { phase: 'ending', working: true, raise: [], clear: ['question', 'failed'] }
      return finish
    case 'failed': {
      // Two hooks answer one failure (the kind's own and the catch-all), in
      // either order: a kind once said is kept.
      const kind = ev.kind ?? (prev?.phase === 'failed' ? prev.kind : undefined)
      // Finished too, so with the Failed line switched off the tab says what it
      // said before hooks: the turn ended.
      return { phase: 'failed', kind, working: false, raise: ['failed', 'finished'], clear: ['question'] }
    }
  }
}

/**
 * Whether `hookStep` needs to know if the box is on screen (#148): only work
 * or a Stop while a question is pending. Every other step reads nothing.
 */
export function screenDecides(prev: HookSession | undefined, ev: HookEvent): boolean {
  return prev?.phase === 'question' && (ev.state === 'working' || ev.state === 'working-title' || ev.state === 'done')
}

/**
 * WHETHER A MARK GOES UP ON THE TAB IN FRONT (#144; owner, 2026-10-09: the
 * question line "should only disappear if you actually answered the
 * question"). Finished and Failed are NEWS: a look tells it, so they go up
 * only where nobody is looking and opening the tab takes them down. A question
 * is a STATE: it lasts while the agent waits on you, so it goes up whoever is
 * looking, and seeing the tab never takes it down; an answer does.
 */
export function raisedWhileSeen(mark: AttentionMark): boolean {
  return mark === 'question'
}
