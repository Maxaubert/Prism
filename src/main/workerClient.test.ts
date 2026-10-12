import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerPool, type PoolProc } from './workerClient'

// The one worker lifecycle (stage 9b): lazy start, one pending map, kept warm
// but not forever, and a dead worker rejects only what it held.

interface Reply {
  id: number
  ok: boolean
  value?: string
}

class FakeProc implements PoolProc<Reply> {
  posted: Array<{ id: number }> = []
  killed = false
  private message: Array<(m: Reply) => void> = []
  private exits: Array<(c: number) => void> = []
  postMessage(m: unknown): void {
    this.posted.push(m as { id: number })
  }
  on(event: 'message' | 'exit', fn: ((m: Reply) => void) | ((c: number) => void)): this {
    if (event === 'message') this.message.push(fn as (m: Reply) => void)
    else this.exits.push(fn as (c: number) => void)
    return this
  }
  kill(): void {
    this.killed = true
    this.exit()
  }
  reply(m: Reply): void {
    for (const fn of this.message) fn(m)
  }
  exit(): void {
    for (const fn of this.exits) fn(0)
  }
}

function pool(idleMs = 1000) {
  const made: FakeProc[] = []
  const p = createWorkerPool<Reply>({
    start: () => {
      const w = new FakeProc()
      made.push(w)
      return w
    },
    settle: (m) => {
      if (!m.ok) throw new Error('bad')
      return m.value
    },
    exitError: 'gone',
    idleMs
  })
  return { p, made }
}

afterEach(() => vi.useRealTimers())

describe('the worker pool', () => {
  it('starts nothing until asked, then one worker for every job', async () => {
    const { p, made } = pool()
    expect(made).toHaveLength(0)
    const a = p.call<string>({ path: 'a' })
    const b = p.call<string>({ path: 'b' })
    expect(made).toHaveLength(1)
    expect(made[0].posted).toEqual([
      { id: 1, path: 'a' },
      { id: 2, path: 'b' }
    ])
    expect(p.pending()).toBe(2)
    made[0].reply({ id: 2, ok: true, value: 'B' })
    made[0].reply({ id: 1, ok: false })
    await expect(b).resolves.toBe('B')
    await expect(a).rejects.toThrow('bad')
    expect(p.pending()).toBe(0)
  })

  it('rejects what a dead worker held, and starts a fresh one', async () => {
    const { p, made } = pool()
    const a = p.call({})
    made[0].exit()
    await expect(a).rejects.toThrow('gone')
    void p.call({})
    expect(made).toHaveLength(2)
  })

  it('kills an idle worker after idleMs, never a busy one', async () => {
    vi.useFakeTimers()
    const { p, made } = pool(1000)
    const a = p.call({})
    made[0].reply({ id: 1, ok: true, value: 'x' })
    await a
    const b = p.call({})
    vi.advanceTimersByTime(5000)
    expect(made[0].killed).toBe(false)
    made[0].reply({ id: 2, ok: true })
    await b
    vi.advanceTimersByTime(999)
    expect(made[0].killed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(made[0].killed).toBe(true)
  })

  it('stop kills the worker and its jobs reject', async () => {
    const { p, made } = pool()
    const a = p.call({})
    p.stop()
    await expect(a).rejects.toThrow('gone')
    expect(made[0].killed).toBe(true)
  })
})
