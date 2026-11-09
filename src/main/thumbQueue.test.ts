import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThumbQueue, desktopShare, type QueueItem } from './thumbQueue'

/**
 * The desktop's queue in front of Thumbs (Stage 2): the order a tab asked in,
 * a new ask that replaces the tab's waiting list, a share of the ffmpeg slots,
 * one job for one key across tabs, a cancel. A job here is a promise the test
 * settles by hand.
 */
interface Job {
  path: string
  tier: number
  signal: AbortSignal
  finish: (file: string | null) => void
}

let jobs: Job[]
let settled: Array<{ tab: string; gen: number; path: string; file: string | null }>
let share: number

function queue(): ThumbQueue {
  return new ThumbQueue({
    make: (path, tier, signal) =>
      new Promise((resolve) => jobs.push({ path, tier, signal, finish: resolve })),
    share: () => share,
    settled: (tab, gen, path, _tier, file) => settled.push({ tab, gen, path, file })
  })
}
const item = (path: string, tier: 320 | 640 = 320): QueueItem => ({ path, tier })
const started = (): string[] => jobs.map((j) => j.path)
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

beforeEach(() => {
  jobs = []
  settled = []
  share = 3
})
afterEach(() => vi.useRealTimers())

describe('desktopShare', () => {
  it('is 3 of the 4 ffmpegs, 1 on a machine of 4 cores or fewer, and 1 while a film plays', () => {
    expect(desktopShare({ cores: 16, filmPlaying: false })).toBe(3)
    expect(desktopShare({ cores: 5, filmPlaying: false })).toBe(3)
    expect(desktopShare({ cores: 4, filmPlaying: false })).toBe(1)
    expect(desktopShare({ cores: 2, filmPlaying: false })).toBe(1)
    expect(desktopShare({ cores: 16, filmPlaying: true })).toBe(1)
  })
})

describe('ThumbQueue', () => {
  it('starts in the order it was asked, at most the share at once', () => {
    const q = queue()
    q.want('t1', 1, [item('a'), item('b'), item('c'), item('d'), item('e')])
    expect(started()).toEqual(['a', 'b', 'c'])
    expect(q.stats()).toEqual({ running: 3, queued: 2 })
    jobs[0].finish('A')
    return tick().then(() => {
      expect(started()).toEqual(['a', 'b', 'c', 'd'])
    })
  })

  it('tells the tab what each job made, with the generation it asked under', async () => {
    const q = queue()
    q.want('t1', 7, [item('a')])
    jobs[0].finish('A.jpg')
    await tick()
    expect(settled).toEqual([{ tab: 't1', gen: 7, path: 'a', file: 'A.jpg' }])
  })

  it('a new ask from the same tab replaces its waiting list and drops only what had not started', async () => {
    const q = queue()
    q.want('t1', 1, [item('a'), item('b'), item('c'), item('d'), item('e')])
    // a, b, c run; d, e wait. The tab scrolled: it wants e and f now.
    q.want('t1', 2, [item('e'), item('f')])
    expect(q.stats().queued).toBe(2)
    expect(started()).toEqual(['a', 'b', 'c'])
    jobs[0].finish('A')
    jobs[1].finish('B')
    jobs[2].finish('C')
    await tick()
    // The ones that were running finish (they are cached for next time) but
    // nobody waits for them any more, so nobody is told.
    expect(settled).toEqual([])
    expect(started()).toEqual(['a', 'b', 'c', 'e', 'f'])
  })

  it('a job running for the new list too is told under the new generation', async () => {
    const q = queue()
    q.want('t1', 1, [item('a')])
    q.want('t1', 2, [item('a'), item('b')])
    jobs[0].finish('A')
    await tick()
    expect(settled).toEqual([{ tab: 't1', gen: 2, path: 'a', file: 'A' }])
  })

  it('one job for one key across tabs, and both tabs are told', async () => {
    const q = queue()
    q.want('t1', 1, [item('a')])
    q.want('t2', 5, [item('a')])
    expect(started()).toEqual(['a'])
    jobs[0].finish('A')
    await tick()
    expect(settled.map((s) => `${s.tab}:${s.gen}`).sort()).toEqual(['t1:1', 't2:5'])
  })

  it('the two tiers of a file are two jobs', () => {
    const q = queue()
    q.want('t1', 1, [item('a', 320), item('a', 640)])
    expect(jobs.map((j) => j.tier)).toEqual([320, 640])
  })

  it('a share of 1 runs one at a time', async () => {
    share = 1
    const q = queue()
    q.want('t1', 1, [item('a'), item('b')])
    expect(started()).toEqual(['a'])
    jobs[0].finish('A')
    await tick()
    expect(started()).toEqual(['a', 'b'])
  })

  it('tabs take turns, so one with a long list does not starve another', () => {
    share = 1
    const q = queue()
    q.want('t1', 1, [item('a1'), item('a2'), item('a3')])
    q.want('t2', 1, [item('b1'), item('b2')])
    // a1 runs; when it ends the next is t2's, then t1's.
    return (async () => {
      jobs[0].finish('x')
      await tick()
      jobs[1].finish('x')
      await tick()
      jobs[2].finish('x')
      await tick()
      expect(started()).toEqual(['a1', 'b1', 'a2', 'b2'])
    })()
  })

  it('cancel drops what waits and tells nobody about it', async () => {
    share = 1
    const q = queue()
    q.want('t1', 1, [item('a'), item('b'), item('c')])
    q.cancel('t1')
    expect(q.stats().queued).toBe(0)
    jobs[0].finish('A')
    await tick()
    expect(settled).toEqual([])
    expect(started()).toEqual(['a'])
  })

  it('cancel keeps a job another tab still wants', async () => {
    const q = queue()
    q.want('t1', 1, [item('a')])
    q.want('t2', 1, [item('a')])
    q.cancel('t1')
    expect(jobs[0].signal.aborted).toBe(false)
    jobs[0].finish('A')
    await tick()
    expect(settled).toEqual([{ tab: 't2', gen: 1, path: 'a', file: 'A' }])
  })

  it('a running job nobody wants any more is killed only past 1.5 s', async () => {
    vi.useFakeTimers()
    const q = queue()
    q.want('t1', 1, [item('slow'), item('quick')])
    vi.advanceTimersByTime(1000)
    q.cancel('t1')
    // 1 s in: let it finish, killing it would cost more than letting it end.
    expect(jobs.every((j) => !j.signal.aborted)).toBe(true)
    vi.advanceTimersByTime(600)
    expect(jobs.every((j) => j.signal.aborted)).toBe(true)
  })

  it('a job that is wanted again before the 1.5 s is not killed', () => {
    vi.useFakeTimers()
    const q = queue()
    q.want('t1', 1, [item('slow')])
    vi.advanceTimersByTime(1000)
    q.want('t1', 2, [])
    q.want('t1', 3, [item('slow')])
    vi.advanceTimersByTime(2000)
    expect(jobs[0].signal.aborted).toBe(false)
  })

  it('a running job nobody wants that is already past 1.5 s is killed at once', () => {
    vi.useFakeTimers()
    const q = queue()
    q.want('t1', 1, [item('slow')])
    vi.advanceTimersByTime(2000)
    q.cancel('t1')
    expect(jobs[0].signal.aborted).toBe(true)
  })

  it('a share that grows starts more on poke', () => {
    share = 1
    const q = queue()
    q.want('t1', 1, [item('a'), item('b'), item('c')])
    expect(started()).toEqual(['a'])
    share = 3
    q.poke()
    expect(started()).toEqual(['a', 'b', 'c'])
  })

  it('a job that throws is a null picture, and the queue keeps going', async () => {
    const q = new ThumbQueue({
      make: (path) => (path === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve('ok')),
      share: () => 1,
      settled: (tab, gen, path, _t, file) => settled.push({ tab, gen, path, file })
    })
    q.want('t1', 1, [item('bad'), item('good')])
    await tick()
    await tick()
    expect(settled).toEqual([
      { tab: 't1', gen: 1, path: 'bad', file: null },
      { tab: 't1', gen: 1, path: 'good', file: 'ok' }
    ])
  })
})
