import { beforeEach, describe, expect, it, vi } from 'vitest'
import { time } from 'prism-term-core/renderer/lib/diag'
import { createSortPass, sortTrigger, type SortInputs } from './sortTiming'

// The diagnostics log's timing (#322), caught rather than sent; it still runs.
vi.mock('prism-term-core/renderer/lib/diag', () => ({
  time: vi.fn((_k: string, fn: () => unknown) => fn())
}))

describe('sortTrigger (#322)', () => {
  const listing = { folders: [], files: [] }
  const base: SortInputs = { listing, query: '', sort: { key: 'name', direction: 'asc' }, sizes: {}, dated: false }

  it('names the input that made the pass run again', () => {
    expect(sortTrigger(null, base)).toBe('listing')
    expect(sortTrigger(base, { ...base, listing: { folders: [], files: [] } })).toBe('listing')
    expect(sortTrigger(base, { ...base, sizes: {} })).toBe('sizes')
    expect(sortTrigger(base, { ...base, query: 'a' })).toBe('query')
    expect(sortTrigger(base, { ...base, sort: { key: 'size', direction: 'asc' } })).toBe('sort')
    expect(sortTrigger(base, { ...base, sort: { key: 'name', direction: 'asc' } })).toBe('other')
    expect(sortTrigger(base, { ...base, dated: true })).toBe('dates')
  })

  it('gives a new listing the pass, whatever moved with it', () => {
    expect(sortTrigger(base, { ...base, listing: { folders: [], files: [] }, sizes: {}, query: 'x' })).toBe('listing')
  })
})

describe('createSortPass (#322)', () => {
  const listing = { folders: [], files: [] }
  const inputs: SortInputs = { listing, query: '', sort: { key: 'name', direction: 'asc' }, sizes: {}, dated: false }
  /** A clock where every pass takes `ms`, and `gap` passes between passes. */
  const clockOf = (ms: number[], gap = 16): (() => number) => {
    let now = 0
    let i = 0
    let inPass = false
    return () => {
      if (!inPass) {
        inPass = true
        now += gap
        return now
      }
      inPass = false
      now += ms[Math.min(i++, ms.length - 1)]
      return now
    }
  }
  const lines = (): unknown[] => vi.mocked(time).mock.calls.map((c) => [c[0], c[2]])
  // Braces: a function returned from beforeEach is run as its cleanup.
  beforeEach(() => {
    vi.mocked(time).mockClear()
  })

  it('writes a slow pass as sort-slow with the row count and its trigger', () => {
    const pass = createSortPass(clockOf([60, 80]))
    expect(pass(inputs)).toEqual([])
    pass({ ...inputs, sizes: {} })
    expect(lines()).toEqual([
      ['sort-slow', { entries: 0, trigger: 'listing' }],
      ['sort-slow', { entries: 0, trigger: 'sizes' }]
    ])
  })

  it('writes nothing for a quick pass', () => {
    const pass = createSortPass(clockOf([10]))
    pass(inputs)
    pass({ ...inputs, sizes: {} })
    expect(lines()).toEqual([])
  })

  it('holds a storm of size ticks to one line, then says how many it held', () => {
    const pass = createSortPass(clockOf([60, 60, 90, 60, 60]))
    pass(inputs)
    for (let i = 0; i < 300; i += 1) pass({ ...inputs, sizes: {} })
    // 300 ticks 16 ms apart plus 60 ms each: about 23 s, so a handful of
    // sizes lines, never 300.
    const sizes = lines().filter((l) => (l as [string, { trigger: string }])[1].trigger === 'sizes')
    expect(sizes.length).toBeGreaterThan(1)
    expect(sizes.length).toBeLessThan(10)
    expect((sizes[1] as [string, { held: number; heldMaxMs: number }])[1]).toMatchObject({ held: expect.any(Number), heldMaxMs: 90 })
  })
})
