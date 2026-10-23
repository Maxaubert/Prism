import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagApi, DiagPageLine } from '../../preload/diagApi'
import { resetDiag, startDiag } from './diag'
import {
  AGENT_LINES_PER_WINDOW,
  AGENT_WINDOW_MS,
  HOOK_FLUSH_MS,
  HOOK_GAP_MS,
  TITLE_NONE_MS,
  createHookFold,
  forgetAgentDiag,
  logAgentHook,
  logAgentMarks,
  logAgentRestore,
  logAgentTitle,
  markChanges,
  noteWhy,
  resetAgentDiag,
  shownMark,
  titleChange,
  type MarkSets
} from './agentDiag'

const T0 = 1_800_000_000_000

function fakeApi(): DiagApi & { lines: () => DiagPageLine[] } {
  const batches: DiagPageLine[][] = []
  return {
    lines: () => batches.flat(),
    diagBatch: (lines: DiagPageLine[]) => {
      batches.push(lines)
    },
    diagBeat: () => {},
    diagInfo: () => Promise.resolve({ verbose: false, dir: 'C:\\logs' }),
    diagSetVerbose: (on: boolean) => Promise.resolve(on),
    diagOpenFolder: () => {},
    diagMark: () => {}
  }
}

const sets = (p: Partial<Record<keyof MarkSets, string[]>> = {}): MarkSets => ({
  workingIds: new Set(p.workingIds ?? []),
  questionIds: new Set(p.questionIds ?? []),
  failedIds: new Set(p.failedIds ?? []),
  doneIds: new Set(p.doneIds ?? [])
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  resetDiag()
  resetAgentDiag()
})
afterEach(() => {
  resetAgentDiag()
  resetDiag()
  vi.useRealTimers()
})

describe('createHookFold', () => {
  it('writes the first signal at once and folds the same state after it into one line', () => {
    const f = createHookFold()
    expect(f.offer('t1', 'working', undefined, T0)).toEqual([{ id: 't1', state: 'working', at: T0 }])
    expect(f.offer('t1', 'working', undefined, T0 + 100)).toEqual([])
    expect(f.offer('t1', 'working', undefined, T0 + 200)).toEqual([])
    // The state changes: the repeats are said first, at the last repeat's time.
    expect(f.offer('t1', 'done', undefined, T0 + 300)).toEqual([
      { id: 't1', state: 'working', repeats: 2, at: T0 + 200 },
      { id: 't1', state: 'done', at: T0 + 300 }
    ])
  })

  it('keeps each tab its own run', () => {
    const f = createHookFold()
    f.offer('t1', 'working', undefined, T0)
    expect(f.offer('t2', 'working', undefined, T0 + 10)).toEqual([{ id: 't2', state: 'working', at: T0 + 10 }])
    expect(f.offer('t1', 'working', undefined, T0 + 20)).toEqual([])
  })

  it('a failure kind is part of the state', () => {
    const f = createHookFold()
    f.offer('t1', 'failed', 'rate_limit', T0)
    expect(f.offer('t1', 'failed', undefined, T0 + 5)).toEqual([{ id: 't1', state: 'failed', at: T0 + 5 }])
  })

  it('held repeats are said at most every HOOK_FLUSH_MS, and the run goes on folding after', () => {
    const f = createHookFold()
    f.offer('t1', 'working', undefined, T0)
    f.offer('t1', 'working', undefined, T0 + 1000)
    expect(f.pending()).toBe(true)
    expect(f.sweep(T0 + HOOK_FLUSH_MS - 1)).toEqual([])
    expect(f.sweep(T0 + HOOK_FLUSH_MS)).toEqual([{ id: 't1', state: 'working', repeats: 1, at: T0 + 1000 }])
    expect(f.pending()).toBe(false)
    // Review of #152: the same state after the flush is still the same run.
    expect(f.offer('t1', 'working', undefined, T0 + HOOK_FLUSH_MS + 8000)).toEqual([])
  })

  it('the same state after HOOK_GAP_MS of silence starts a new line', () => {
    const f = createHookFold()
    f.offer('t1', 'working', undefined, T0)
    expect(f.offer('t1', 'working', undefined, T0 + HOOK_GAP_MS)).toEqual([{ id: 't1', state: 'working', at: T0 + HOOK_GAP_MS }])
  })

  it('a single signal has no repeats line, and forget says what was held', () => {
    const f = createHookFold()
    f.offer('t1', 'done', undefined, T0)
    expect(f.sweep(T0 + HOOK_GAP_MS + 10_000)).toEqual([])
    f.offer('t1', 'working', undefined, T0 + HOOK_GAP_MS + 11_000)
    f.offer('t1', 'working', undefined, T0 + HOOK_GAP_MS + 11_100)
    expect(f.forget('t1')).toEqual([{ id: 't1', state: 'working', repeats: 1, at: T0 + HOOK_GAP_MS + 11_100 }])
    expect(f.forget('t1')).toEqual([])
  })

  it('tool calls seconds apart (review of #152): ten minutes of work stay a few lines', () => {
    const f = createHookFold()
    const out: unknown[] = []
    // A tool call every 8 s for ten minutes (Pre and Post, 2 s apart), swept every 5 s as the page does.
    for (let t = 0; t < 600_000; t += 1000) {
      if (t % 8000 === 0 || t % 8000 === 2000) out.push(...f.offer('t1', 'working', undefined, T0 + t))
      if (t % 5000 === 0) out.push(...f.sweep(T0 + t))
    }
    out.push(...f.offer('t1', 'done', undefined, T0 + 600_000))
    // 150 signals: the first, about one count every 30 s, the done.
    expect(out.length).toBeLessThanOrEqual(23)
    expect(out.reduce((n: number, l) => n + ((l as { repeats?: number }).repeats ?? 1), 0)).toBe(151)
  })
})

describe('titleChange', () => {
  it('only a change of meaning, never another spinner frame', () => {
    expect(titleChange(undefined, 'working')).toBe('working')
    expect(titleChange('working', 'working')).toBe(null)
    expect(titleChange('working', 'idle')).toBe('idle')
    expect(titleChange('idle', 'none')).toBe('none')
  })
  it('a tab that never had an agent title says nothing for none', () => {
    expect(titleChange(undefined, 'none')).toBe(null)
  })
})

describe('shownMark and markChanges', () => {
  it('working outranks question, which outranks failed, then done', () => {
    expect(shownMark(sets({ workingIds: ['a'], doneIds: ['a'] }), 'a')).toBe('working')
    expect(shownMark(sets({ questionIds: ['a'], failedIds: ['a'], doneIds: ['a'] }), 'a')).toBe('question')
    expect(shownMark(sets({ failedIds: ['a'], doneIds: ['a'] }), 'a')).toBe('failed')
    expect(shownMark(sets(), 'a')).toBe('none')
  })

  it('says each move once, with the marks held under it', () => {
    const prev = new Map<string, string>()
    expect(markChanges(prev, sets({ workingIds: ['a'] }))).toEqual([{ id: 'a', from: 'none', to: 'working', held: [] }])
    expect(markChanges(prev, sets({ workingIds: ['a'] }))).toEqual([])
    expect(markChanges(prev, sets({ failedIds: ['a'], doneIds: ['a'] }))).toEqual([
      { id: 'a', from: 'working', to: 'failed', held: ['failed', 'done'] }
    ])
    // Finished goes under the question: the shown mark stays, what is held moves.
    expect(markChanges(prev, sets({ questionIds: ['a'] }))).toEqual([{ id: 'a', from: 'failed', to: 'question', held: ['question'] }])
    expect(markChanges(prev, sets({ questionIds: ['a'], doneIds: ['a'] }))).toEqual([
      { id: 'a', from: 'question', to: 'question', held: ['question', 'done'] }
    ])
    expect(markChanges(prev, sets())).toEqual([{ id: 'a', from: 'question', to: 'none', held: [] }])
    expect(prev.size).toBe(0)
  })
})

describe('the page record', () => {
  async function started() {
    const api = fakeApi()
    startDiag(api, {})
    await Promise.resolve()
    return api
  }
  const flush = async () => {
    await vi.advanceTimersByTimeAsync(300)
  }

  it('folds a turn of tool calls into two hook lines', async () => {
    const api = await started()
    for (let i = 0; i < 40; i += 1) {
      logAgentHook('t1', 'working')
      vi.advanceTimersByTime(10)
    }
    logAgentHook('t1', 'done')
    await flush()
    expect(api.lines().filter((l) => l.k === 'agent-hook').map(({ k, id, state, repeats }) => ({ k, id, state, repeats }))).toEqual([
      { k: 'agent-hook', id: 't1', state: 'working', repeats: undefined },
      { k: 'agent-hook', id: 't1', state: 'working', repeats: 39 },
      { k: 'agent-hook', id: 't1', state: 'done', repeats: undefined }
    ])
  })

  it('a quiet tab has its repeats said by the sweep', async () => {
    const api = await started()
    logAgentHook('t1', 'working')
    logAgentHook('t1', 'working')
    await vi.advanceTimersByTimeAsync(HOOK_FLUSH_MS + 5300)
    expect(api.lines().filter((l) => l.k === 'agent-hook').map((l) => l.repeats ?? 0)).toEqual([0, 1])
  })

  it('writes a title only when its meaning changes', async () => {
    const api = await started()
    logAgentTitle('t1', 'none')
    logAgentTitle('t1', 'working', 'claude')
    logAgentTitle('t1', 'working', 'claude')
    logAgentTitle('t1', 'idle', 'claude')
    logAgentTitle('t1', 'none')
    await vi.advanceTimersByTimeAsync(TITLE_NONE_MS + 300)
    expect(api.lines().filter((l) => l.k === 'agent-title').map((l) => l.state)).toEqual(['working', 'idle', 'none'])
  })

  it("a child's title between an agent's (Codex runs npm, cmd.exe) is not a none (review of #152)", async () => {
    const api = await started()
    logAgentTitle('t1', 'working', 'codex')
    for (let i = 0; i < 20; i += 1) {
      logAgentTitle('t1', 'none')
      vi.advanceTimersByTime(500)
      logAgentTitle('t1', 'working', 'codex')
      vi.advanceTimersByTime(500)
    }
    await flush()
    expect(api.lines().filter((l) => l.k === 'agent-title').map((l) => l.state)).toEqual(['working'])
  })

  it('a failure kind outside Claude\'s own list is written as other (review of #152: it is pty bytes)', async () => {
    const api = await started()
    logAgentHook('t1', 'failed', 'rate_limit')
    logAgentHook('t1', 'failed', 'hunter2')
    await flush()
    expect(api.lines().filter((l) => l.k === 'agent-hook').map((l) => l.kind)).toEqual(['rate_limit', 'other'])
  })

  it('a flood of signals is capped per tab, and the next line says how many were dropped', async () => {
    const api = await started()
    for (let i = 0; i < 1000; i += 1) logAgentHook('t1', i % 2 ? 'working' : 'done')
    logAgentHook('t2', 'working')
    await flush()
    const t1 = api.lines().filter((l) => l.k === 'agent-hook' && l.id === 't1')
    expect(t1.length).toBe(AGENT_LINES_PER_WINDOW)
    expect(api.lines().some((l) => l.id === 't2')).toBe(true)
    vi.advanceTimersByTime(AGENT_WINDOW_MS)
    logAgentHook('t1', 'question')
    await flush()
    const after = api.lines().filter((l) => l.k === 'agent-hook' && l.id === 't1').slice(AGENT_LINES_PER_WINDOW)
    expect(after[0]).toMatchObject({ dropped: 1000 - AGENT_LINES_PER_WINDOW })
  })

  it('a rule noted longer ago than a second is not a reason, however busy the tab (review of #152)', async () => {
    const api = await started()
    noteWhy('t1', 'stale')
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(800)
      noteWhy('t1', 'hook working')
    }
    noteWhy('t1', 'hook done')
    logAgentMarks(sets({ doneIds: ['t1'] }))
    await flush()
    expect(api.lines().find((l) => l.k === 'agent-mark')).toMatchObject({ why: 'hook working + hook done' })
  })

  it('a mark carries the rule that moved it, and only a fresh one', async () => {
    const api = await started()
    noteWhy('t1', 'hook working')
    logAgentMarks(sets({ workingIds: ['t1'] }), () => 'claude')
    noteWhy('t1', 'hook done')
    noteWhy('t1', 'hook done')
    logAgentMarks(sets({ doneIds: ['t1'] }))
    noteWhy('t1', 'stale')
    vi.advanceTimersByTime(1500)
    logAgentMarks(sets())
    await flush()
    const marks = api.lines().filter((l) => l.k === 'agent-mark')
    expect(marks.map(({ from, to, why }) => ({ from, to, why }))).toEqual([
      { from: 'none', to: 'working', why: 'hook working' },
      { from: 'working', to: 'done', why: 'hook done' },
      { from: 'done', to: 'none', why: 'unknown' }
    ])
    expect(marks[0].agent).toBe('claude')
  })

  it('a restored tab says so, and its marks say how long after', async () => {
    const api = await started()
    logAgentRestore('t1', 'C:\\work')
    vi.advanceTimersByTime(2000)
    noteWhy('t1', 'hook done')
    logAgentMarks(sets({ doneIds: ['t1'] }))
    await flush()
    expect(api.lines().find((l) => l.k === 'agent-restore')).toMatchObject({ id: 't1', cwd: 'C:\\work', resume: true })
    expect(api.lines().find((l) => l.k === 'agent-mark')).toMatchObject({ to: 'done', why: 'hook done', restored: 2000 })
  })

  it('a closed tab says its held repeats', async () => {
    const api = await started()
    logAgentHook('t1', 'working')
    logAgentHook('t1', 'working')
    forgetAgentDiag('t1')
    await flush()
    expect(api.lines().filter((l) => l.k === 'agent-hook').map((l) => l.repeats ?? 0)).toEqual([0, 1])
  })
})
