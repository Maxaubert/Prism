import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { DetectedAgent } from '../../shared/types'
import { activitySuppressed, inputEcho, markBorn, startupOutput } from './termActivity'
import { forgetAgentTitle, readAgentTitle } from './agentTitle'
import { noteWorking } from './agentClock'
import { onAgentSignal, onTermKey, onTitle, readScreenTail } from './termBus'
import { answersQuestion, looksLikeQuestion, questionAnswered } from './agentQuestion'
import {
  BACKGROUND_CHECK_MS,
  hookStep,
  raisedWhileSeen,
  screenDecides,
  STOP_SETTLE_MS,
  type AttentionMark,
  type HookEvent,
  type HookSession
} from './agentHookState'
import { looksLikeBackgroundWork } from './agentBackground'
import { termApi } from '../host'
import { forgetAgentDiag, logAgentHook, logAgentMarks, logAgentTitle, noteWhy } from './agentDiag'

/**
 * Which tabs host an agent, which are mid-answer, and which finished while
 * you were looking elsewhere. Lifted out of Prism's App unchanged in its
 * rules; a tab here IS its session, so one id serves for both.
 *
 * Tab activity, Tabby-style: a pty is SILENT at an idle prompt and streams
 * continuously while an AI CLI works (its spinner repaints). The marks are
 * AGENT-SCOPED: main polls each shell's process tree for Claude Code and
 * kin, and a plain terminal never shows one (the bell was tried and
 * abandoned - PSReadLine dings on every invalid key).
 */
export interface AgentIndicator {
  agentIds: ReadonlySet<string>
  workingIds: ReadonlySet<string>
  doneIds: ReadonlySet<string>
  /** Sessions whose agent is waiting on YOU (a question or a permission
   *  prompt), 2026-09-28. Marked until it is ANSWERED, looking or not (#144). */
  questionIds: ReadonlySet<string>
  /** Sessions whose turn ended on an error, told by Claude Code's own hook
   *  (#131), marked while you were not looking at them. */
  failedIds: ReadonlySet<string>
  /** Each failed session's error kind (`rate_limit`...), when the hook named
   *  one. A ref, read whenever `failedIds` changes. */
  failedKinds: RefObject<Map<string, string>>
  /** Which agent each session hosts. A ref: read at the moment of asking. */
  agentKinds: RefObject<Map<string, DetectedAgent>>
  /** The session ended: every mark it carried goes with it. */
  forget: (id: string) => void
}

const without = (prev: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  if (!prev.has(id)) return prev
  const next = new Set(prev)
  next.delete(id)
  return next
}

export function useAgentIndicator(activeId: string | null): AgentIndicator {
  const [agentIds, setAgentIds] = useState<ReadonlySet<string>>(new Set())
  const [workingIds, setWorkingIds] = useState<ReadonlySet<string>>(new Set())
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set())
  const [questionIds, setQuestionIds] = useState<ReadonlySet<string>>(new Set())
  /** The pending questions, for a key handler to ask at the moment of the key. */
  const questionsNow = useRef(questionIds)
  useEffect(() => {
    questionsNow.current = questionIds
  }, [questionIds])
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set())
  const failedKinds = useRef(new Map<string, string>())
  /**
   * SESSIONS THAT SPEAK THROUGH HOOKS (#131), and the phase each last said.
   * For these the hooks are the agent's word: the title says an Esc and the
   * work a Yes approved (`agentHookState`), the output is never scored, and
   * the screen is read only to HOLD a question the hooks raised while its box
   * is up (#148), never to raise one. A session that never sends one keeps everything
   * below as it was: Codex, a Claude started before the update, a folder not
   * trusted yet, plugins blocked by policy, or the setting off.
   */
  const hooked = useRef(new Map<string, HookSession>())
  /**
   * LOOKING AT A TAB is having it in front AND the window focused (2026-09-28;
   * owner: the marks "stay there until you click the tab"). A tab that finished
   * or asked while the window was behind another app was not seen either.
   */
  const [focused, setFocused] = useState(() => (typeof document === 'undefined' ? true : document.hasFocus()))
  useEffect(() => {
    const on = (): void => setFocused(true)
    const off = (): void => setFocused(false)
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  const looking = useRef({ activeId, focused })
  useEffect(() => {
    looking.current = { activeId, focused }
  }, [activeId, focused])
  /**
   * COMING BACK IS A LOOK TOO (owner, 2026-10-14: "i sent a message with this
   * tab in focus, changed window, it completed i came back, and that mark was
   * there. it shouldnt have been there since thats the selected tab ... the
   * badge should disappear"). A finish while the window is behind another app
   * still raises Finished, and the taskbar badge counts it; the pointer MOVING
   * over the window is the owner back, and takes the tab in front's mark down
   * with the badge, before any click gives the window focus. A pointer merely
   * resting over it while typing elsewhere is not: only movement counts, and
   * only for that moment (`MOVE_LOOK_MS`).
   */
  const [moved, setMoved] = useState(0)
  const movedAt = useRef(0)
  // Whether a look by the pointer could take anything down: only a Finished
  // or Failed mark on the tab in front (perf review 2026-10-16: every move
  // over the unfocused window re-rendered App twice a second for nothing).
  const frontMarked = useRef(false)
  useEffect(() => {
    frontMarked.current = !!activeId && (doneIds.has(activeId) || failedIds.has(activeId))
  }, [activeId, doneIds, failedIds])
  useEffect(() => {
    const MOVE_LOOK_MS = 1000
    let last = 0
    const onMove = (): void => {
      // The window's focus as this hook hears it (focus and blur), not
      // document.hasFocus(): under Playwright that is always true (MEASURED in
      // the parked e2e window), and the two must agree.
      if (looking.current.focused) return
      const now = Date.now()
      movedAt.current = now
      if (!frontMarked.current) return
      // A look every half second at most: a moving pointer fires constantly.
      if (now - last < MOVE_LOOK_MS / 2) return
      last = now
      setMoved((n) => n + 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
  const lookedAt = (id: string): boolean => looking.current.focused && looking.current.activeId === id
  /** The last title state of each titled session, so output can be checked
   *  for a question only while its agent is idle. */
  const titleState = useRef(new Map<string, string>())
  const questionTimers = useRef(new Map<string, number>())
  /** The screen reads pending after a key that may have answered a question.
   *  A NEW question cancels them: its box may not be drawn yet, and a read in
   *  that gap would take it down unanswered (review of #144). */
  const answerTimers = useRef(new Map<string, number[]>())
  const stopAnswerCheck = useCallback((id: string): void => {
    for (const t of answerTimers.current.get(id) ?? []) clearTimeout(t)
    answerTimers.current.delete(id)
  }, [])
  /** Read the session's screen for Claude's question box: mark it when it
   *  appears (on the tab in front too, #144), unmark it when it has gone. */
  const checkQuestion = useCallback((id: string): void => {
    if (questionTimers.current.has(id)) return
    questionTimers.current.set(
      id,
      window.setTimeout(() => {
        questionTimers.current.delete(id)
        const asking = titleState.current.get(id) === 'idle' && looksLikeQuestion(readScreenTail(id))
        noteWhy(id, asking ? 'screen read: question box' : 'screen read: no question box')
        setQuestionIds((prev) => {
          if (asking && !prev.has(id)) return new Set(prev).add(id)
          if (!asking && prev.has(id)) return without(prev, id)
          return prev
        })
      }, 200)
    )
  }, [])
  const agentKinds = useRef(new Map<string, DetectedAgent>())
  const outputRuns = useRef(new Map<string, { start: number; last: number }>())
  /** Sessions whose agent reports its state through the title (Claude). */
  const titled = useRef(new Set<string>())
  /** Sessions the process poll has said host an agent. */
  const polled = useRef(new Set<string>())
  /**
   * ASK THE POLL TO LOOK, AT MOST ONCE IN 15 S PER TAB (perf review
   * 2026-10-16). Every title frame and hook signal of an agent the poll has
   * not reported asked for a look, and a Claude the poll can never see (under
   * WSL or SSH) kept PowerShell queries running back to back while it worked.
   * Main also holds forced looks 5 s apart (agentPoll).
   */
  const lookAsked = useRef(new Map<string, number>())
  const askLook = useCallback((id: string): void => {
    if (polled.current.has(id)) return
    const now = Date.now()
    if (now - (lookAsked.current.get(id) ?? Number.NEGATIVE_INFINITY) < 15_000) return
    lookAsked.current.set(id, now)
    termApi().termAgentLook?.()
  }, [])
  /** The one clearing timer per fallback-scored session. */
  const fallbackTimers = useRef(new Map<string, number>())
  const stopFallback = useCallback((id: string): void => {
    const t = fallbackTimers.current.get(id)
    if (t !== undefined) {
      clearTimeout(t)
      fallbackTimers.current.delete(id)
    }
  }, [])

  /**
   * A SPINNER HELD BY THE BOX, READ AGAIN (#148). MEASURED: the first spinner
   * title after a Yes came 6 ms BEFORE the repaint that erased the box (22860
   * and 22866 ms), so the title alone would wait for the next frame, about
   * 960 ms. One re-read per session, 250 ms on; a new question, the agent
   * leaving or the session ending cancels it.
   */
  const titleRecheck = useRef(new Map<string, number>())
  const stopTitleRecheck = useCallback((id: string): void => {
    const t = titleRecheck.current.get(id)
    if (t !== undefined) clearTimeout(t)
    titleRecheck.current.delete(id)
  }, [])
  /** The re-read calls the current `applyHook`, which is declared below it. */
  const applyHookRef = useRef<(id: string, ev: HookEvent) => void>(() => {})

  /** A Stop that came with the spinner up waits this long for a title (#149):
   *  one timer per session, gone with the step that ends the wait. */
  const settleTimers = useRef(new Map<string, number>())
  const stopSettle = useCallback((id: string): void => {
    const t = settleTimers.current.get(id)
    if (t !== undefined) clearTimeout(t)
    settleTimers.current.delete(id)
  }, [])

  /** Background work is re-read until the screen lets it go: one timer per
   *  session, armed again after every read that found it still there (a read
   *  that changes nothing still needs the next one). */
  const armBgCheck = useCallback((id: string): void => {
    if (settleTimers.current.has(id)) return
    settleTimers.current.set(
      id,
      window.setTimeout(() => {
        settleTimers.current.delete(id)
        applyHookRef.current(id, { state: 'bg-check' })
      }, BACKGROUND_CHECK_MS)
    )
  }, [])

  /** One hook signal, or a title, for a hooked session: the rules are
   *  `agentHookState`'s; this only carries them out. A mark is raised only on
   *  a tab nobody is looking at, as every mark is. */
  const applyHook = useCallback((id: string, ev: HookEvent): void => {
    const prev = hooked.current.get(id)
    // The screen is read only when the box decides the step: a question pending.
    const boxUp = screenDecides(prev, ev) && looksLikeQuestion(readScreenTail(id))
    // A Stop is told the title's last word: a spinner still up may be
    // background subagents at work (#149).
    // The steps that can end a turn read the screen for work still running
    // after it: a background shell, a workflow (`agentBackground`).
    const turnEnds =
      ev.state === 'done' || ev.state === 'settle' || ev.state === 'bg-check' || ev.state === 'idle-title'
    const bgUp = turnEnds && (ev.state !== 'idle-title' || prev?.phase === 'ending' || prev?.phase === 'background')
      ? looksLikeBackgroundWork(readScreenTail(id))
      : false
    const o = hookStep(prev, ev, {
      ...(boxUp ? { questionOnScreen: true } : {}),
      ...(ev.state === 'done' || ev.state === 'bg-check' ? { titleWorking: titleState.current.get(id) === 'working' } : {}),
      ...(bgUp ? { backgroundOnScreen: true } : {})
    })
    if (!o) {
      if (prev?.phase === 'background') armBgCheck(id)
      if (boxUp && ev.state === 'working-title' && !titleRecheck.current.has(id)) {
        titleRecheck.current.set(
          id,
          window.setTimeout(() => {
            titleRecheck.current.delete(id)
            if (titleState.current.get(id) === 'working') applyHookRef.current(id, { state: 'working-title' })
          }, 250)
        )
      }
      return
    }
    hooked.current.set(id, { phase: o.phase, kind: o.kind })
    stopSettle(id)
    if (o.phase === 'ending')
      settleTimers.current.set(
        id,
        window.setTimeout(() => {
          settleTimers.current.delete(id)
          applyHookRef.current(id, { state: 'settle' })
        }, STOP_SETTLE_MS)
      )
    if (o.phase === 'background') armBgCheck(id)
    // The rule that fired, for the diagnostics log (#152).
    const said =
      ev.state === 'bg-check'
        ? 'background work over'
        : bgUp && o.phase === 'background'
          ? 'work still running on screen'
          : ev.state === 'settle'
            ? 'no title after a Stop'
        : ev.state === 'idle-title'
          ? prev?.phase === 'ending' || prev?.phase === 'background'
            ? `idle title after a Stop${prev.phase === 'background' ? ' and background work' : ''}`
            : 'idle title after work (an Esc)'
          : ev.state === 'working-title'
            ? `spinner after ${prev?.phase ?? 'nothing'}`
            : ev.state === 'done' && o.phase === 'ending'
              ? 'hook done, spinner still up'
              : `hook ${ev.state}`
    noteWhy(id, `${said}${boxUp ? ', box on screen' : ''}${lookedAt(id) ? ', tab in front' : ''}`)
    if (o.phase === 'failed' && o.kind) failedKinds.current.set(id, o.kind)
    else if (o.phase === 'failed' || o.clear.includes('failed')) failedKinds.current.delete(id)
    const away = !lookedAt(id)
    if (o.raise.includes('question')) {
      stopAnswerCheck(id)
      stopTitleRecheck(id)
    }
    const marks = (mark: AttentionMark) => (prev: ReadonlySet<string>): ReadonlySet<string> => {
      if ((away || raisedWhileSeen(mark)) && o.raise.includes(mark)) return prev.has(id) ? prev : new Set(prev).add(id)
      return o.clear.includes(mark) ? without(prev, id) : prev
    }
    setDoneIds(marks('finished'))
    setQuestionIds(marks('question'))
    setFailedIds(marks('failed'))
    setWorkingIds((prev) => {
      if (prev.has(id) === o.working) return prev
      return o.working ? new Set(prev).add(id) : without(prev, id)
    })
  }, [stopAnswerCheck, stopTitleRecheck, stopSettle, armBgCheck])
  useEffect(() => {
    applyHookRef.current = applyHook
  }, [applyHook])

  useEffect(
    () =>
      termApi().onTermAgent((id, present, kind) => {
        // For the log, only a verdict that changes something: an agent found,
        // or one gone that the poll, a title or a hook had claimed.
        if (present ? !polled.current.has(id) : polled.current.has(id) || hooked.current.has(id) || titled.current.has(id))
          noteWhy(id, present ? 'poll found agent' : 'poll lost agent')
        if (present) polled.current.add(id)
        else polled.current.delete(id)
        // Another agent in this shell now: whatever Claude's hooks said was
        // about the one that left.
        if (!present || (kind && kind !== 'claude')) hooked.current.delete(id)
        if (present && kind) agentKinds.current.set(id, kind)
        else if (!present) {
          agentKinds.current.delete(id)
          // The agent left: its title state and any working mark go with it,
          // and the next agent in this shell starts on the fallback again.
          titled.current.delete(id)
          forgetAgentTitle(id)
          stopFallback(id)
          stopTitleRecheck(id)
          stopSettle(id)
          setWorkingIds((prev) => without(prev, id))
          // Nobody is left to answer a question (#144).
          setQuestionIds((prev) => without(prev, id))
          failedKinds.current.delete(id)
          setFailedIds((prev) => without(prev, id))
        }
        if (present) {
          // An agent's BIRTH state is idle: its startup paint (banner, welcome
          // box, the loading spinners after it) is a stream, but it is not the
          // agent answering anything. Wipe the run, and score nothing until
          // the FIRST SILENCE after the agent appeared (2026-09-04): the 4s
          // clock this replaced guessed at how late the poll noticed the
          // agent and how long the machine took to boot it, and at app start
          // with several tabs resuming at once the paint outlasted it - so
          // the tail of a startup lit the tab as an answer underway.
          outputRuns.current.delete(id)
          markBorn(id)
          setWorkingIds((prev) => without(prev, id))
        }
        setAgentIds((prev) => {
          if (present === prev.has(id)) return prev
          const next = new Set(prev)
          if (present) next.add(id)
          else next.delete(id)
          return next
        })
      }),
    [stopFallback, stopTitleRecheck, stopSettle]
  )

  useEffect(
    () =>
      termApi().onTermData((id) => {
        // Its hooks say everything, questions included (#131).
        if (hooked.current.has(id)) return
        // A session whose agent SAYS what it is doing (through the title,
        // see onTitle below) is never scored from its output: the agent's
        // own word is exact, and its repaints would only second-guess it.
        // Its output while idle is only read for a question box appearing or
        // going (2026-09-28).
        if (titled.current.has(id)) {
          if (titleState.current.get(id) === 'idle') checkQuestion(id)
          return
        }
        // Output on the heels of a keystroke is that keystroke's echo (the TUI
        // repainting its input box), so typing at an idle agent never scores.
        // Every chunk is shown to the birth rule (it tracks the gaps), and
        // only then is the rest of the scoring asked.
        const startup = startupOutput(id)
        if (startup || activitySuppressed(id) || inputEcho(id)) return
        if (!agentKinds.current.has(id)) return
        const now = Date.now()
        const run = outputRuns.current.get(id)
        if (!run || now - run.last > 1500) outputRuns.current.set(id, { start: now, last: now })
        else run.last = now
        const r = outputRuns.current.get(id)!
        // EVENT-DRIVEN, no loop (owner, 2026-09-04): the chunk that carries
        // the run past the sustain sets working right then, and ONE timer
        // armed on the latest chunk clears it after the silence.
        if (r.last - r.start > 1200) {
          noteWhy(id, 'output scored working')
          setWorkingIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
          stopFallback(id)
          fallbackTimers.current.set(
            id,
            window.setTimeout(() => {
              fallbackTimers.current.delete(id)
              noteWhy(id, 'output went quiet')
              setWorkingIds((prev) => without(prev, id))
            }, 2000)
          )
        }
      }),
    [stopFallback, checkQuestion]
  )

  /**
   * The agent's OWN word (2026-09-04, owner: "instant, and event-driven").
   * Claude Code writes its state into the terminal title - a spinner glyph
   * while working, MEASURED at 30ms after Enter and at the instant an answer
   * lands - so the indicator follows the title and nothing else for such a
   * session. Codex has a dialect of its own (a braille spinner before the
   * folder name, the bare name at rest) and the reader knows both. A Claude
   * title is also the agent being present, NOW, ahead of the process poll
   * that would have said so up to 2.5s later. A braille spinner is common
   * currency (ora, and every CLI built on it), so the Codex dialect is acted
   * on only once the poll has found an agent in the shell; the poll notices
   * either leaving. Sessions with no title state keep the output fallback.
   */
  useEffect(
    () =>
      onTitle((id, title) => {
        const r = readAgentTitle(id, title)
        // The title's MEANING for the log, never its text (#152): a no-op for a
        // shell that never had an agent title.
        if (!r) {
          logAgentTitle(id, 'none')
          return
        }
        if (r.kind === 'codex' && !agentKinds.current.has(id)) return
        logAgentTitle(id, r.state, r.kind)
        // Present by its title alone: have the poll look now, so it sees the
        // agent while it runs and can say when it leaves (#73). Only the poll
        // ever takes a title's claim back.
        askLook(id)
        if (!titled.current.has(id)) {
          titled.current.add(id)
          outputRuns.current.delete(id)
          stopFallback(id)
        }
        if (!agentKinds.current.has(id)) agentKinds.current.set(id, r.kind)
        setAgentIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
        titleState.current.set(id, r.state)
        // A session speaking through hooks: the title says an Esc (#131), and
        // a spinner after a question is the work its Yes approved (#148).
        if (hooked.current.has(id)) {
          if (r.state === 'idle') applyHook(id, { state: 'idle-title' })
          else if (r.state === 'working') applyHook(id, { state: 'working-title' })
          return
        }
        noteWhy(id, `title ${r.state}`)
        // Idle is where a question is asked: read the screen for its box.
        // Codex says it outright (#131). Any other state is the agent at work
        // again, so no question is pending.
        if (r.state === 'idle') checkQuestion(id)
        else if (r.state === 'question') {
          if (!questionsNow.current.has(id)) stopAnswerCheck(id)
          setQuestionIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
        }
        else setQuestionIds((prev) => without(prev, id))
        const working = r.state === 'working'
        setWorkingIds((prev) => {
          if (prev.has(id) === working) return prev
          const next = new Set(prev)
          if (working) next.add(id)
          else next.delete(id)
          return next
        })
      }),
    [stopFallback, checkQuestion, applyHook, stopAnswerCheck, askLook]
  )

  /**
   * CLAUDE CODE'S HOOKS (#131), through the bundled plugin's OSC 777. Only
   * Claude's UI writes one (never `claude -p`, MEASURED), so a signal is that
   * agent being present, as a Claude title is: the poll is asked to look, and
   * only the poll takes it back. From the first signal the session is hooked.
   */
  useEffect(
    () =>
      onAgentSignal((id, signal) => {
        logAgentHook(id, signal.state, signal.kind)
        askLook(id)
        if (!hooked.current.has(id)) {
          outputRuns.current.delete(id)
          stopFallback(id)
          const t = questionTimers.current.get(id)
          if (t !== undefined) clearTimeout(t)
          questionTimers.current.delete(id)
        }
        if (!agentKinds.current.has(id)) agentKinds.current.set(id, 'claude')
        setAgentIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
        applyHook(id, signal)
      }),
    [stopFallback, applyHook, askLook]
  )

  /**
   * AN ANSWER NO HOOK REPORTS (#144). Turning a permission prompt down, or
   * cancelling a question with Esc, ends the turn without a hook (no Stop on an
   * interrupt), so a key that settles a box is heard here: the question is
   * answered once the box has gone from the screen after it (`questionAnswered`).
   * Read four times over five seconds, since the agent repaints a moment after
   * the key and a busy machine can make that moment long: a hooked session's
   * screen is read nowhere else, so a single late repaint would leave the line
   * up until the next prompt (review of #144). A box still up is the next of
   * several questions, still pending.
   */
  useEffect(
    () =>
      onTermKey((id, key) => {
        if (!answersQuestion(key) || !questionsNow.current.has(id)) return
        stopAnswerCheck(id)
        answerTimers.current.set(
          id,
          [250, 1000, 2500, 5000].map((ms) =>
            window.setTimeout(() => {
              if (!questionAnswered(key, readScreenTail(id))) return
              stopAnswerCheck(id)
              noteWhy(id, 'answer key, box gone')
              setQuestionIds((prev) => without(prev, id))
            }, ms)
          )
        )
      }),
    [stopAnswerCheck]
  )

  // THE MARKS IN THE DIAGNOSTICS LOG (#152): every change of a tab's mark,
  // with the rule noted just before it. Declared BEFORE the effect below, so a
  // render's changes are written before that effect notes its own rules for
  // the next render. Reads only; it changes nothing.
  useEffect(() => {
    logAgentMarks({ workingIds, questionIds, failedIds, doneIds }, (id) => agentKinds.current.get(id))
  }, [workingIds, questionIds, failedIds, doneIds])

  // Finished-while-away: an agent that STOPS working on a background tab
  // leaves a mark that stays until the tab is visited (or work restarts).
  const prevWorking = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    // The one place that sees the transition, so the one place that can time
    // it: `outputRuns.start` is a burst length, not a work duration.
    noteWorking(workingIds)
    const was = prevWorking.current
    prevWorking.current = workingIds
    const seeing = (id: string): boolean => id === activeId && (focused || Date.now() - movedAt.current < 1000)
    /** Why a mark comes down here, for the log (#152). */
    const cleared = (id: string): string =>
      workingIds.has(id) ? 'working again' : seeing(id) ? 'tab looked at' : 'agent gone'
    setDoneIds((prev) => {
      let next: Set<string> | null = null
      const mut = (): Set<string> => (next ??= new Set(prev))
      for (const id of was) {
        // Stopped, still an agent session, and nobody was looking at it: its
        // tab was in the background, or the window was.
        // A hooked session is told apart by its hooks instead (#131): a
        // question or an Esc stops the work too, and neither is a finish.
        if (!workingIds.has(id) && agentIds.has(id) && !seeing(id) && !hooked.current.has(id)) {
          noteWhy(id, 'stopped working while away')
          mut().add(id)
        }
      }
      for (const id of prev) {
        if (workingIds.has(id) || seeing(id) || !agentIds.has(id)) {
          noteWhy(id, cleared(id))
          mut().delete(id)
        }
      }
      return next ?? prev
    })
    // A QUESTION IS NOT CLEARED BY A LOOK (#144; owner, 2026-10-09: "if you go
    // on that tab and then just move to another tab without answering the
    // question, the blue bar shouldn't disappear"). It goes when it is
    // answered, or when no agent is left in the session to wait.
    setQuestionIds((prev) => {
      let next = prev
      for (const id of prev)
        if (!agentIds.has(id)) {
          noteWhy(id, 'agent gone')
          next = without(next, id)
        }
      return next
    })
    // A failure you are now looking at has been seen.
    setFailedIds((prev) => {
      let next = prev
      for (const id of prev)
        if (seeing(id) || workingIds.has(id) || !agentIds.has(id)) {
          noteWhy(id, cleared(id))
          next = without(next, id)
        }
      return next
    })
  }, [workingIds, activeId, agentIds, focused, moved])

  // STABLE: a host subscribes to the pty's exit ONCE and calls this from there.
  const forget = useCallback((id: string): void => {
    noteWhy(id, 'closed')
    forgetAgentDiag(id)
    outputRuns.current.delete(id)
    titled.current.delete(id)
    polled.current.delete(id)
    lookAsked.current.delete(id)
    agentKinds.current.delete(id)
    forgetAgentTitle(id)
    stopFallback(id)
    setAgentIds((prev) => without(prev, id))
    setWorkingIds((prev) => without(prev, id))
    setDoneIds((prev) => without(prev, id))
    setQuestionIds((prev) => without(prev, id))
    setFailedIds((prev) => without(prev, id))
    hooked.current.delete(id)
    failedKinds.current.delete(id)
    titleState.current.delete(id)
    const t = questionTimers.current.get(id)
    if (t !== undefined) clearTimeout(t)
    questionTimers.current.delete(id)
    stopAnswerCheck(id)
    stopTitleRecheck(id)
    stopSettle(id)
  }, [stopFallback, stopAnswerCheck, stopTitleRecheck, stopSettle])

  return { agentIds, workingIds, doneIds, questionIds, failedIds, failedKinds, agentKinds, forget }
}
