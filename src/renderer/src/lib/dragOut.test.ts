import { describe, expect, it } from 'vitest'
import { nativePaths, prefetchPlan, PREFETCH_BUDGET, PREFETCH_MAX_ENTRIES } from './dragOut'

const m = (path: string, size: number, dir = false) => ({ path, size, dir })

describe('prefetchPlan (what a press extracts ahead of a drag)', () => {
  it('extracts what is not ready yet, within the budget', () => {
    const plan = prefetchPlan([m('a.jpg', 100), m('b.jpg', 200)], new Set(['a.jpg']))
    expect(plan).toEqual(['b.jpg'])
  })

  it('does nothing past the size budget or past the entry cap', () => {
    expect(prefetchPlan([m('big.iso', PREFETCH_BUDGET + 1)], new Set())).toEqual([])
    const many = Array.from({ length: PREFETCH_MAX_ENTRIES + 1 }, (_, i) => m(`f${i}`, 1))
    expect(prefetchPlan(many, new Set())).toEqual([])
    expect(prefetchPlan([], new Set())).toEqual([])
  })

  it('a folder counts as the archive lists it', () => {
    expect(prefetchPlan([m('Comics/', 1000, true)], new Set())).toEqual(['Comics/'])
  })
})

describe('nativePaths (the drag goes native only when every copy is ready)', () => {
  it('maps every entry to its temp copy', () => {
    const copies = new Map([
      ['a.jpg', 'C:\\t\\a.jpg'],
      ['b.jpg', 'C:\\t\\b.jpg']
    ])
    expect(nativePaths(['a.jpg', 'b.jpg'], copies)).toEqual(['C:\\t\\a.jpg', 'C:\\t\\b.jpg'])
  })

  it('is null when any copy is missing, and for nothing at all', () => {
    expect(nativePaths(['a.jpg', 'b.jpg'], new Map([['a.jpg', 'C:\\t\\a.jpg']]))).toBeNull()
    expect(nativePaths([], new Map())).toBeNull()
  })
})
