import { describe, expect, it, vi } from 'vitest'
import { createSpareIdle, type SpareIdleDeps } from './spareIdle'

function harness(over: Partial<SpareIdleDeps> = {}) {
  let now = 0
  let last = 0
  let settled = false
  let allowed = true
  let tick: (() => void) | null = null
  let fire: (() => void) | null = null
  const make = vi.fn()
  const drop = vi.fn()
  const lines: Array<Record<string, unknown>> = []
  const spare = createSpareIdle({
    now: () => now,
    lastActivity: () => last,
    settled: () => settled,
    allowed: () => allowed,
    make,
    drop,
    log: (f) => lines.push(f),
    quietMs: 1500,
    every: (fn) => {
      tick = fn
      return { cancel: () => (tick = null) }
    },
    after: (fn) => {
      fire = fn
      return { cancel: () => (fire = null) }
    },
    ...over
  })
  return {
    spare,
    make,
    drop,
    lines,
    set: (o: { now?: number; last?: number; settled?: boolean; allowed?: boolean }) => {
      if (o.now !== undefined) now = o.now
      if (o.last !== undefined) last = o.last
      if (o.settled !== undefined) settled = o.settled
      if (o.allowed !== undefined) allowed = o.allowed
    },
    tick: () => tick?.(),
    polling: () => !!tick,
    timeout: () => fire?.()
  }
}

describe('the spare is made only when Prism is idle (owner, 2026-11-06)', () => {
  it('never during startup, never while busy, then once a quiet spell comes', () => {
    const h = harness()
    h.spare.want()
    h.set({ now: 5000 })
    h.tick()
    expect(h.make).not.toHaveBeenCalled() // startup not settled
    h.set({ settled: true, last: 4000 })
    h.tick()
    expect(h.make).not.toHaveBeenCalled() // input a second ago
    h.set({ now: 5600 })
    h.tick()
    expect(h.make).toHaveBeenCalledTimes(1)
    expect(h.polling()).toBe(false)
  })

  it('never in standby (not allowed), and a cancel stops the wait', () => {
    const h = harness()
    h.set({ settled: true, now: 10_000, allowed: false })
    h.spare.want()
    h.tick()
    expect(h.make).not.toHaveBeenCalled()
    h.spare.cancel()
    expect(h.polling()).toBe(false)
  })

  it('a slow constructor is logged and the spare is given up for the session', () => {
    let now = 10_000
    const h = harness({ now: () => now, make: vi.fn(() => (now += 2000)) })
    h.set({ settled: true })
    h.spare.want()
    h.tick()
    expect(h.lines).toEqual([{ phase: 'make', ms: 2000, gaveUp: true }])
    expect(h.spare.gaveUp()).toBe(true)
    h.spare.want()
    expect(h.polling()).toBe(false)
  })

  it('a page not ready in time is dropped and given up; a ready one is kept', () => {
    const h = harness()
    h.set({ settled: true, now: 10_000 })
    h.spare.want()
    h.tick()
    h.timeout()
    expect(h.drop).toHaveBeenCalledTimes(1)
    expect(h.lines[0]).toMatchObject({ phase: 'ready', gaveUp: true })

    const ok = harness()
    ok.set({ settled: true, now: 10_000 })
    ok.spare.want()
    ok.tick()
    ok.spare.ready()
    ok.timeout()
    expect(ok.drop).not.toHaveBeenCalled()
    expect(ok.spare.gaveUp()).toBe(false)
  })
})
