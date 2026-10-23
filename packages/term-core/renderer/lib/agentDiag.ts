import { record } from './diag'
import { STOP_FAILURE_KINDS } from './agentHookSignal'

/**
 * THE AGENT INDICATOR IN THE DIAGNOSTICS LOG (#152; owner, 2026-10-10). Bugs
 * like #151 (restored tabs showed Finished after a restart, though nothing
 * finished) could only be guessed at: the log said nothing about the marks. It
 * now says, at the quiet level and always on:
 *
 * - `agent-hook`: every Claude Code hook signal (OSC 777 prism-agent): the
 *   tab, the state, the failure's kind (one of Claude's own, else `other`: the
 *   kind is pty bytes). A run of the SAME state on a tab (a tool call is a
 *   PreToolUse and a PostToolUse, both `working`, dozens a turn) is folded: the
 *   first is written at once, the rest are counted and written as ONE line
 *   with `repeats` when the tab's state changes or it closes, and otherwise at
 *   most every `HOOK_FLUSH_MS` (the line's `t` is the last repeat's). The same
 *   state after `HOOK_GAP_MS` of silence starts a new line. Review of #152: a
 *   5 s quiet gap ended the run, and the model's thinking between tool calls
 *   is usually longer, so nearly every signal was a line of its own.
 * - `agent-title`: the agent title's MEANING (`idle`, `working`, `starting`,
 *   `question`, `none` once it is no agent's title), only when it changes:
 *   Claude repaints its spinner title about every 960 ms while working. `none`
 *   is written only once it has held `TITLE_NONE_MS`: Codex's child processes
 *   set titles of their own between its spinners (`agentTitle.ts`).
 * - Every tab has at most `AGENT_LINES_PER_WINDOW` hook, title and mark lines
 *   per `AGENT_WINDOW_MS`: any program can print the OSC or a title, and a
 *   flood would roll the whole log over (as an error each frame once did). The
 *   next line written says `dropped`.
 * - `agent-mark`: each change of the mark a tab's indicator holds (`none`,
 *   `working`, `question`, `failed`, `done`, in the strip's own order), with
 *   `held` (every attention mark under it) and `why`, the rule that fired.
 *   The mark is the indicator's, before the host's Finished / Question /
 *   Failed switches and its indicator style decide what is drawn.
 * - `agent-restore`: a tab restored over an agent conversation, so the marks
 *   just after a restart are easy to find; a mark within `RESTORED_MS` of it
 *   carries `restored` (ms since).
 *
 * NEVER typed text, screen text, a title's text or anything of the
 * conversation (`PRIVACY.md`): states, rule names, tab ids and the folder.
 */

export const HOOK_FLUSH_MS = 30_000
export const HOOK_GAP_MS = 60_000
/** How often the page looks for held repeats to say. */
const SWEEP_MS = 5000
export const TITLE_NONE_MS = 2000
export const AGENT_WINDOW_MS = 10_000
export const AGENT_LINES_PER_WINDOW = 40
/** A reason noted longer ago than this belongs to no change. */
const WHY_MS = 1000
const RESTORED_MS = 60_000
const KNOWN_KINDS: ReadonlySet<string> = new Set(STOP_FAILURE_KINDS)

export type ShownMark = 'none' | 'working' | 'question' | 'failed' | 'done'

export interface MarkSets {
  workingIds: ReadonlySet<string>
  questionIds: ReadonlySet<string>
  failedIds: ReadonlySet<string>
  doneIds: ReadonlySet<string>
}

/** The mark a tab holds, in the strip's order (`TabStrip`: working first). */
export function shownMark(s: MarkSets, id: string): ShownMark {
  if (s.workingIds.has(id)) return 'working'
  if (s.questionIds.has(id)) return 'question'
  if (s.failedIds.has(id)) return 'failed'
  if (s.doneIds.has(id)) return 'done'
  return 'none'
}

/** Every attention mark a tab holds, the shown one or under it. */
export function heldMarks(s: MarkSets, id: string): string[] {
  const out: string[] = []
  if (s.questionIds.has(id)) out.push('question')
  if (s.failedIds.has(id)) out.push('failed')
  if (s.doneIds.has(id)) out.push('done')
  return out
}

export interface MarkChange {
  id: string
  from: ShownMark
  to: ShownMark
  held: string[]
}

/** The tabs whose mark (or the marks under it) changed since `prev`, which is
 *  brought up to date. A tab back at `none` with nothing held is forgotten. */
export function markChanges(prev: Map<string, string>, s: MarkSets): MarkChange[] {
  const ids = new Set<string>([...prev.keys(), ...s.workingIds, ...s.questionIds, ...s.failedIds, ...s.doneIds])
  const out: MarkChange[] = []
  for (const id of ids) {
    const to = shownMark(s, id)
    const held = heldMarks(s, id)
    const key = `${to}|${held.join(',')}`
    const was = prev.get(id) ?? 'none|'
    if (key === was) continue
    out.push({ id, from: was.split('|')[0] as ShownMark, to, held })
    if (to === 'none' && held.length === 0) prev.delete(id)
    else prev.set(id, key)
  }
  return out
}

export interface HookLine {
  id: string
  state: string
  kind?: string
  repeats?: number
  at: number
}

/** The folding of `agent-hook` lines (above). Pure: `offer` a signal, `sweep`
 *  for the runs gone quiet, `forget` a tab that closed. */
export function createHookFold(flushMs = HOOK_FLUSH_MS, gapMs = HOOK_GAP_MS) {
  /** `wrote`: when this run last had a line written. */
  type Run = { state: string; kind?: string; count: number; last: number; wrote: number }
  const runs = new Map<string, Run>()
  const repeats = (id: string, r: Run): HookLine[] =>
    r.count > 0 ? [{ id, state: r.state, ...(r.kind ? { kind: r.kind } : {}), repeats: r.count, at: r.last }] : []
  return {
    offer(id: string, state: string, kind: string | undefined, now: number): HookLine[] {
      const run = runs.get(id)
      if (run && run.state === state && run.kind === kind && now - run.last < gapMs) {
        run.count += 1
        run.last = now
        return []
      }
      const out = run ? repeats(id, run) : []
      runs.set(id, { state, kind, count: 0, last: now, wrote: now })
      out.push({ id, state, ...(kind ? { kind } : {}), at: now })
      return out
    },
    /** The held repeats of each run last written `flushMs` ago or more; the
     *  run goes on. A run silent for `gapMs` with nothing held is let go. */
    sweep(now: number): HookLine[] {
      const out: HookLine[] = []
      for (const [id, run] of runs) {
        if (run.count > 0 && now - run.wrote >= flushMs) {
          out.push(...repeats(id, run))
          run.count = 0
          run.wrote = now
        }
        if (run.count === 0 && now - run.last >= gapMs) runs.delete(id)
      }
      return out
    },
    forget(id: string): HookLine[] {
      const run = runs.get(id)
      runs.delete(id)
      return run ? repeats(id, run) : []
    },
    /** Whether any run still has repeats to say (a sweep is then due). */
    pending(): boolean {
      for (const run of runs.values()) if (run.count > 0) return true
      return false
    }
  }
}

/** The new meaning of a tab's title when it changed, else null. A tab that
 *  never had an agent title says nothing for a title that is none. */
export function titleChange(prev: string | undefined, next: string): string | null {
  return next === (prev ?? 'none') ? null : next
}

// ---- The page's one record (one indicator per page, in either host). ----

let fold = createHookFold()
let sweepTimer: ReturnType<typeof setTimeout> | null = null
const titles = new Map<string, string>()
const noneTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Each rule noted for a tab, with when: only the last second's are a reason. */
const whys = new Map<string, Array<{ why: string; at: number }>>()
const marks = new Map<string, string>()
const restoredAt = new Map<string, number>()
const budgets = new Map<string, { start: number; n: number; dropped: number }>()

/** A hook, title or mark line, within the tab's budget (above). */
function emit(k: string, fields: Record<string, unknown> & { id: string }, at: number = Date.now()): void {
  const now = Date.now()
  let b = budgets.get(fields.id)
  if (!b || now - b.start >= AGENT_WINDOW_MS) {
    b = { start: now, n: 0, dropped: b?.dropped ?? 0 }
    budgets.set(fields.id, b)
  }
  if (b.n >= AGENT_LINES_PER_WINDOW) {
    b.dropped += 1
    return
  }
  b.n += 1
  const dropped = b.dropped
  b.dropped = 0
  record(k, dropped ? { ...fields, dropped } : fields, at)
}

const write = (lines: HookLine[]): void => {
  for (const { at, ...l } of lines) emit('agent-hook', l, at)
}

function armSweep(): void {
  if (sweepTimer !== null || !fold.pending()) return
  sweepTimer = setTimeout(() => {
    sweepTimer = null
    write(fold.sweep(Date.now()))
    armSweep()
  }, SWEEP_MS)
}

/** A hook signal reached the tab. */
export function logAgentHook(id: string, state: string, kind?: string): void {
  const k = kind === undefined ? undefined : KNOWN_KINDS.has(kind) ? kind : 'other'
  write(fold.offer(id, state, k, Date.now()))
  armSweep()
}

function stopNone(id: string): void {
  const t = noneTimers.get(id)
  if (t !== undefined) clearTimeout(t)
  noneTimers.delete(id)
}

/** The tab's title was read as `state` (`none`: no agent's title). */
export function logAgentTitle(id: string, state: string, agent?: string): void {
  if (state !== 'none') stopNone(id)
  const change = titleChange(titles.get(id), state)
  if (change === null) return
  if (change !== 'none') {
    titles.set(id, change)
    emit('agent-title', { id, state: change, ...(agent ? { agent } : {}) })
    return
  }
  if (noneTimers.has(id)) return
  noneTimers.set(
    id,
    setTimeout(() => {
      noneTimers.delete(id)
      titles.delete(id)
      emit('agent-title', { id, state: 'none' })
    }, TITLE_NONE_MS)
  )
}

/** The rule about to change a tab's marks: written with the change it makes. */
export function noteWhy(id: string, why: string): void {
  const now = Date.now()
  const fresh = (whys.get(id) ?? []).filter((w) => now - w.at <= WHY_MS && w.why !== why)
  fresh.push({ why, at: now })
  whys.set(id, fresh)
}

/** The indicator's sets after a render: a line for each tab whose mark moved. */
export function logAgentMarks(s: MarkSets, agentOf?: (id: string) => string | undefined): void {
  const now = Date.now()
  for (const c of markChanges(marks, s)) {
    const fresh = (whys.get(c.id) ?? []).filter((w) => now - w.at <= WHY_MS)
    whys.delete(c.id)
    const why = fresh.length ? fresh.map((w) => w.why).join(' + ') : 'unknown'
    const restored = restoredAt.get(c.id)
    const agent = agentOf?.(c.id)
    emit('agent-mark', {
      id: c.id,
      from: c.from,
      to: c.to,
      held: c.held,
      why,
      ...(agent ? { agent } : {}),
      ...(restored !== undefined && now - restored <= RESTORED_MS ? { restored: now - restored } : {})
    })
  }
  // A closed tab's rules and budget, once nothing is left to say with them.
  for (const [id, w] of whys) if (w.every((x) => now - x.at > WHY_MS)) whys.delete(id)
  for (const [id, b] of budgets) if (b.dropped === 0 && now - b.start >= AGENT_WINDOW_MS) budgets.delete(id)
}

/** A tab restored over an agent conversation (the resume rides its spawn). */
export function logAgentRestore(id: string, cwd: string | null): void {
  restoredAt.set(id, Date.now())
  record('agent-restore', { id, cwd, resume: true })
}

/** The tab closed: its folded repeats are said, and the rest forgotten. */
export function forgetAgentDiag(id: string): void {
  write(fold.forget(id))
  stopNone(id)
  titles.delete(id)
  restoredAt.delete(id)
}

/** For tests: a fresh page. */
export function resetAgentDiag(): void {
  if (sweepTimer !== null) clearTimeout(sweepTimer)
  sweepTimer = null
  fold = createHookFold()
  for (const id of [...noneTimers.keys()]) stopNone(id)
  budgets.clear()
  titles.clear()
  whys.clear()
  marks.clear()
  restoredAt.clear()
}
