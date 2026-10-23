import { describe, expect, it } from 'vitest'
import { createDiagGate } from './diagGate'

describe('createDiagGate', () => {
  it('writes an error once, holds its copies, and says how many on the next line', () => {
    const gate = createDiagGate<{ msg: string }>(10_000, 10)
    expect(gate.offer('page-error', 'boom', { msg: 'boom' }, 0)).toEqual({ msg: 'boom' })
    // Sixty a second for five seconds: none written.
    for (let t = 16; t < 5000; t += 16) expect(gate.offer('page-error', 'boom', { msg: 'boom' }, t)).toBeNull()
    expect(gate.sweep(5000)).toEqual([])
    const again = gate.offer('page-error', 'boom', { msg: 'boom' }, 10_000)
    expect(again).toMatchObject({ msg: 'boom' })
    expect(again?.repeats).toBeGreaterThan(300)
  })

  it('sweeps a burst that stopped, so its copies are still counted', () => {
    const gate = createDiagGate<{ msg: string }>(10_000, 10)
    gate.offer('page-error', 'boom', { msg: 'boom' }, 0)
    gate.offer('page-error', 'boom', { msg: 'boom' }, 100)
    gate.offer('page-error', 'boom', { msg: 'boom' }, 200)
    expect(gate.sweep(9_999)).toEqual([])
    expect(gate.sweep(10_000)).toEqual([{ msg: 'boom', repeats: 2 }])
    expect(gate.sweep(20_000)).toEqual([])
  })

  it('caps the lines per kind, whatever they say: a message with a counter is a new key each time', () => {
    const gate = createDiagGate<{ msg: string }>(10_000, 10)
    const written = Array.from({ length: 100 }, (_, i) => gate.offer('page-error', `n${i}`, { msg: `n${i}` }, i))
    expect(written.filter(Boolean)).toHaveLength(10)
    // Another kind has its own budget.
    expect(gate.offer('page-rejection', 'r', { msg: 'r' }, 100)).not.toBeNull()
    // The held ones come out as the budget allows, ten per window.
    expect(gate.sweep(10_000)).toHaveLength(10)
  })
})
