import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureTermCore, resetTermCore, type TermApi, type TermHostConfig } from '../host'
import { linkRanges, onPathsFound, pathCandidates, resetPathCache, takeAsked } from './termPathLinks'

const paths = (text: string): string[] => pathCandidates(text).map((p) => p.path)

describe('pathCandidates', () => {
  it('leaves the prompt alone, PowerShell and cmd', () => {
    expect(paths('PS C:\\Users\\me\\work> ls docs/a.pdf')).toEqual(['docs/a.pdf'])
    expect(paths('C:\\Users\\me\\work>dir')).toEqual([])
    // The same folder written in a sentence IS a path.
    expect(paths('it is in C:\\Users\\me\\work now')).toEqual(['C:\\Users\\me\\work'])
  })
  it('leaves a path inside a web link to the link', () => {
    expect(paths('see https://github.com/a/b/blob/main/README.md and README.md')).toEqual(['README.md'])
  })
})

// #167: a found path woke EVERY tab's painter, and each rescanned its whole
// scrollback (MEASURED in Stable's diag log, 2026-10-10 16:58Z: 2009 ms and
// 2046 ms page stacks in `scan` around a 2153 ms term:path-kinds). A found path
// is news only to the tab that asked about it.
describe('who hears that a path exists (#167)', () => {
  /** The paths that exist; every other one names nothing. */
  const real = new Set(['a.txt', 'b.txt'])
  let pending: Array<() => void> = []
  const ask = vi.fn((cwd: string, texts: string[]) => {
    void cwd
    return new Promise<Array<{ kind: 'file'; abs: string } | null>>((resolve) => {
      pending.push(() => resolve(texts.map((t) => (real.has(t) ? { kind: 'file', abs: `C:\\w\\${t}` } : null))))
    })
  })
  /** Main answers every batch it was asked, then the promises settle. */
  const answer = async (): Promise<void> => {
    const now = pending
    pending = []
    now.forEach((f) => f())
    await vi.advanceTimersByTimeAsync(0)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    pending = []
    ask.mockClear()
    configureTermCore({ api: { termPathKinds: ask } as unknown as TermApi } as TermHostConfig)
  })
  afterEach(() => {
    resetPathCache()
    resetTermCore()
    vi.useRealTimers()
  })

  it('a hit wakes the tab that asked, and no other', async () => {
    const a = vi.fn()
    const b = vi.fn()
    onPathsFound('A', a)
    onPathsFound('B', b)
    linkRanges('see a.txt', 'C:\\w', 'A')
    await vi.advanceTimersByTimeAsync(40)
    await answer()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('a tab that asks for a path already in flight hears the answer too, once', async () => {
    const a = vi.fn()
    const b = vi.fn()
    onPathsFound('A', a)
    onPathsFound('B', b)
    linkRanges('see b.txt', 'C:\\w', 'A')
    await vi.advanceTimersByTimeAsync(40) // A's batch is asked
    linkRanges('see b.txt', 'C:\\w', 'B') // ... and B asks while it is out
    await vi.advanceTimersByTimeAsync(40)
    await answer()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('a path that names nothing wakes nobody', async () => {
    const a = vi.fn()
    onPathsFound('A', a)
    linkRanges('see nope.txt', 'C:\\w', 'A')
    await vi.advanceTimersByTimeAsync(40)
    await answer()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()
  })

  it('an unsubscribed listener hears nothing', async () => {
    const a = vi.fn()
    const off = onPathsFound('A', a)
    off()
    linkRanges('see a.txt', 'C:\\w', 'A')
    await vi.advanceTimersByTimeAsync(40)
    await answer()
    expect(a).not.toHaveBeenCalled()
  })

  it('takeAsked says once that a line queued a question, and not for a line fully known', async () => {
    linkRanges('see a.txt', 'C:\\w', 'A')
    expect(takeAsked('A')).toBe(true)
    expect(takeAsked('A')).toBe(false)
    expect(takeAsked('B')).toBe(false)
    await vi.advanceTimersByTimeAsync(40)
    await answer()
    expect(linkRanges('see a.txt', 'C:\\w', 'A')).toEqual([{ start: 4, end: 9, path: 'a.txt' }])
    expect(takeAsked('A')).toBe(false)
  })

  it('a line whose path is already being asked about still waits for it', async () => {
    linkRanges('see a.txt', 'C:\\w', 'A')
    takeAsked('A')
    await vi.advanceTimersByTimeAsync(40) // in flight now
    linkRanges('again a.txt', 'C:\\w', 'A')
    expect(takeAsked('A')).toBe(true)
  })
})
