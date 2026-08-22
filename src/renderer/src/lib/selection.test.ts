import { describe, expect, it } from 'vitest'
import { clickSelect, emptySelection, sweepSelect } from './selection'

const order = ['a', 'b', 'c', 'd', 'e']

describe('clickSelect', () => {
  it('a plain click replaces the selection and moves the anchor', () => {
    const s1 = clickSelect(order, emptySelection, 'b', {})
    expect([...s1.items]).toEqual(['b'])
    const s2 = clickSelect(order, s1, 'd', {})
    expect([...s2.items]).toEqual(['d'])
    expect(s2.anchor).toBe('d')
  })

  it('shift ranges from the anchor, either direction, anchor unmoved', () => {
    const s1 = clickSelect(order, emptySelection, 'b', {})
    const down = clickSelect(order, s1, 'd', { shift: true })
    expect([...down.items].sort()).toEqual(['b', 'c', 'd'])
    expect(down.anchor).toBe('b')
  })

  it('a shifted range MERGES with what is already marked', () => {
    // File 1 marked, then shift from 4 up to 2: 1 stays in.
    const one = clickSelect(order, emptySelection, 'a', {})
    const four = clickSelect(order, one, 'd', { ctrl: true })
    const merged = clickSelect(order, four, 'b', { shift: true })
    expect([...merged.items].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ctrl toggles one row without touching the rest', () => {
    const s1 = clickSelect(order, emptySelection, 'a', {})
    const s2 = clickSelect(order, s1, 'c', { ctrl: true })
    expect([...s2.items].sort()).toEqual(['a', 'c'])
    const s3 = clickSelect(order, s2, 'a', { ctrl: true })
    expect([...s3.items]).toEqual(['c'])
  })

  it('shift with no anchor selects just the clicked row', () => {
    const s = clickSelect(order, emptySelection, 'c', { shift: true })
    expect([...s.items]).toEqual(['c'])
  })

  it('a row missing from the order still merges in rather than throwing', () => {
    const s1 = clickSelect(order, emptySelection, 'a', {})
    const s2 = clickSelect(order, s1, 'ghost', { shift: true })
    expect([...s2.items].sort()).toEqual(['a', 'ghost'])
  })
})

describe('sweepSelect', () => {
  it('is the swept range, either direction', () => {
    expect([...sweepSelect(order, 'b', 'd').items].sort()).toEqual(['b', 'c', 'd'])
    expect([...sweepSelect(order, 'd', 'b').items].sort()).toEqual(['b', 'c', 'd'])
    expect(sweepSelect(order, 'b', 'd').anchor).toBe('b')
  })

  it('merges with the selection the sweep began over', () => {
    const base = new Set(['a'])
    expect([...sweepSelect(order, 'd', 'c', base).items].sort()).toEqual(['a', 'c', 'd'])
    // Shrinking the sweep sheds only the sweep's own rows, never the base.
    expect([...sweepSelect(order, 'd', 'd', base).items].sort()).toEqual(['a', 'd'])
  })
})
