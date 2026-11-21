import { describe, expect, it } from 'vitest'
import { SLOTS, slotPool } from './highlightSlots'

describe('highlight slots', () => {
  it('hands out the lowest free number and takes a released one back', () => {
    const pool = slotPool()
    expect([pool.claim(), pool.claim(), pool.claim()]).toEqual([1, 2, 3])
    pool.release(2)
    expect(pool.claim()).toBe(2)
  })

  it('keeps one pool per kind of find', () => {
    const a = slotPool()
    const b = slotPool()
    expect(a.claim()).toBe(1)
    expect(b.claim()).toBe(1)
  })

  it('shares slot 1 rather than run out', () => {
    const pool = slotPool()
    for (let i = 0; i < SLOTS; i += 1) pool.claim()
    expect(pool.claim()).toBe(1)
  })
})