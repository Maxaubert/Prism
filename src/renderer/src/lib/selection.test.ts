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
    const up = clickSelect(order, down, 'a', { shift: true })
    expect([...up.items].sort()).toEqual(['a', 'b'])
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

  it('a row missing from the order still selects alone rather than throwing', () => {
    const s1 = clickSelect(order, emptySelection, 'a', {})
    const s2 = clickSelect(order, s1, 'ghost', { shift: true })
    expect([...s2.items]).toEqual(['ghost'])
  })
})

describe('sweepSelect', () => {
  it('is the swept range, either direction', () => {
    expect([...sweepSelect(order, 'b', 'd').items].sort()).toEqual(['b', 'c', 'd'])
    expect([...sweepSelect(order, 'd', 'b').items].sort()).toEqual(['b', 'c', 'd'])
    expect(sweepSelect(order, 'b', 'd').anchor).toBe('b')
  })
})
