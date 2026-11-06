import { describe, expect, it } from 'vitest'
import { createStandby, lastWindowClosed, standbyWanted, STANDBY_KEY } from './standby'

describe('standby (owner, 2026-11-06)', () => {
  it('is on unless switched off; under --e2e only when the scenario asks', () => {
    expect(standbyWanted({}, false, {})).toBe(true)
    expect(standbyWanted({ [STANDBY_KEY]: 'off' }, false, {})).toBe(false)
    expect(standbyWanted({}, true, {})).toBe(false)
    expect(standbyWanted({}, true, { PRISM_E2E_STANDBY: '1' })).toBe(true)
    expect(standbyWanted({ [STANDBY_KEY]: 'off' }, true, { PRISM_E2E_STANDBY: '1' })).toBe(false)
  })

  it('the last window closing rests, unless an update, a log-off, a quit or the switch says go', () => {
    const base = { quitting: false, installingUpdate: false, sessionEnded: false, wanted: true }
    expect(lastWindowClosed(base)).toEqual({ standby: true })
    expect(lastWindowClosed({ ...base, installingUpdate: true })).toEqual({ standby: false, reason: 'update' })
    expect(lastWindowClosed({ ...base, sessionEnded: true })).toEqual({ standby: false, reason: 'session-end' })
    expect(lastWindowClosed({ ...base, quitting: true })).toEqual({ standby: false, reason: null })
    expect(lastWindowClosed({ ...base, wanted: false })).toEqual({ standby: false, reason: 'last-window' })
  })

  it('every part rests on enter and wakes in reverse order; one that throws stops none of the others', () => {
    const order: string[] = []
    const lines: Array<Record<string, unknown>> = []
    let t = 1000
    const part = (name: string, bad = false) => ({
      name,
      sleep: () => {
        order.push(`sleep ${name}`)
        if (bad) throw new Error('no')
      },
      wake: () => order.push(`wake ${name}`)
    })
    const s = createStandby({ parts: [part('a'), part('b', true), part('c')], log: (f) => lines.push(f), now: () => t })
    expect(s.wake('win-e')).toBeNull()
    s.enter()
    s.enter()
    expect(s.on()).toBe(true)
    t = 61_000
    expect(s.wake('win-e')).toBe(60_000)
    expect(s.on()).toBe(false)
    expect(order).toEqual(['sleep a', 'sleep b', 'sleep c', 'wake c', 'wake b', 'wake a'])
    expect(lines).toEqual([
      { ev: 'enter', failed: ['b'] },
      { ev: 'wake', why: 'win-e', restedMs: 60_000 }
    ])
  })
})
