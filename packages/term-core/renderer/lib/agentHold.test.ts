import { describe, expect, it } from 'vitest'
import { HeldMarks, lookingAt } from './agentHold'

const away = { activeId: 'a', focused: false }
const here = { activeId: 'a', focused: true }

describe('HeldMarks (finished while away on the tab in front, 2026-10-21)', () => {
  it('holds a mark raised on the tab in front with the window away', () => {
    const h = new HeldMarks()
    h.raised('a', away)
    expect(h.has('a')).toBe(true)
  })

  it('does not hold a background tab (cleared by visiting) or a mark raised while looking', () => {
    const h = new HeldMarks()
    h.raised('b', away)
    h.raised('a', here)
    expect(h.has('b')).toBe(false)
    expect(h.has('a')).toBe(false)
  })

  it('focus coming back, or a look, does not take a held mark down', () => {
    const h = new HeldMarks()
    h.raised('a', away)
    expect(lookingAt('a', here)).toBe(true)
    expect(h.seen('a', here)).toBe(false)
  })

  it('an unheld mark is still taken down by a look', () => {
    expect(new HeldMarks().seen('a', here)).toBe(true)
    expect(new HeldMarks().seen('a', away)).toBe(false)
  })

  it('the same tab clicked again keeps it; leaving the tab releases it (2026-10-23)', () => {
    const h = new HeldMarks()
    h.raised('a', away)
    expect(h.moved('a')).toEqual([])
    expect(h.has('a')).toBe(true)
    expect(h.moved('b')).toEqual(['a'])
    expect(h.has('a')).toBe(false)
    expect(h.seen('a', here)).toBe(true)
  })

  it('drop ends the hold (work again, agent gone, tab closed)', () => {
    const h = new HeldMarks()
    h.raised('a', away)
    h.drop('a')
    expect(h.has('a')).toBe(false)
  })
})
