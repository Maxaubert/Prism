import { describe, expect, it } from 'vitest'
import { DRAG_OUT_BYTES, nativePaths, prefetchPlan, samePathSet, validRequest } from './dragOut'

describe('the drag-out rules (#103)', () => {
  it('prefetchPlan: the members not ready yet, within 64 MB and 64 members', () => {
    const items = [
      { entry: 'a.txt', size: 10, dir: false },
      { entry: 'docs', size: 100, dir: true }
    ]
    expect(prefetchPlan(items, new Set())).toEqual(['a.txt', 'docs'])
    expect(prefetchPlan(items, new Set(['a.txt']))).toEqual(['docs'])
    expect(prefetchPlan(items, new Set(['a.txt', 'docs']))).toEqual([])
  })

  it('prefetchPlan: over the budget is null, folders counted at their listed size', () => {
    expect(prefetchPlan([{ entry: 'f', size: DRAG_OUT_BYTES + 1, dir: true }], new Set())).toBeNull()
    expect(prefetchPlan([{ entry: 'f', size: DRAG_OUT_BYTES, dir: false }], new Set())).toEqual(['f'])
    const many = Array.from({ length: 65 }, (_, i) => ({ entry: `${i}`, size: 1, dir: false }))
    expect(prefetchPlan(many, new Set())).toBeNull()
    expect(prefetchPlan(many.slice(0, 64), new Set())).toHaveLength(64)
    expect(prefetchPlan([], new Set())).toBeNull()
  })

  it('nativePaths: every copy in order, or null when one is missing', () => {
    const copies = new Map([
      ['a', 'C:\\t\\a'],
      ['b', 'C:\\t\\b']
    ])
    expect(nativePaths(['b', 'a'], copies)).toEqual(['C:\\t\\b', 'C:\\t\\a'])
    expect(nativePaths(['a', 'c'], copies)).toBeNull()
    expect(nativePaths([], copies)).toBeNull()
  })

  it('samePathSet: same paths in any order and case, nothing more or less', () => {
    expect(samePathSet(['C:\\A\\x.txt', 'C:\\a\\y.txt'], ['c:\\a\\y.txt', 'C:\\a\\X.TXT'])).toBe(true)
    expect(samePathSet(['C:\\a\\x.txt'], ['C:\\a\\x.txt', 'C:\\a\\y.txt'])).toBe(false)
    expect(samePathSet(['C:\\a\\x.txt', 'C:\\a\\x.txt'], ['C:\\a\\x.txt', 'C:\\a\\y.txt'])).toBe(false)
    expect(samePathSet([], [])).toBe(false)
  })

  it('validRequest: files, or members with one place each', () => {
    expect(validRequest({ kind: 'files', paths: ['C:\\a'] })).toBe(true)
    expect(validRequest({ kind: 'files', paths: [] })).toBe(false)
    expect(validRequest({ kind: 'files', paths: [3] })).toBe(false)
    expect(validRequest({ kind: 'members', archive: 'C:\\z.zip', entries: ['a'], places: ['C:\\z.zip\\a'] })).toBe(true)
    expect(validRequest({ kind: 'members', archive: 'C:\\z.zip', entries: ['a', 'b'], places: ['C:\\z.zip\\a'] })).toBe(false)
    expect(validRequest(null)).toBe(false)
  })
})
