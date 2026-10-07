import { describe, expect, it, vi } from 'vitest'
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
  it('times each pass as sort-slow with the row count and its trigger', () => {
    const pass = createSortPass()
    const listing = { folders: [], files: [] }
    const inputs: SortInputs = { listing, query: '', sort: { key: 'name', direction: 'asc' }, sizes: {}, dated: false }
    expect(pass(inputs)).toEqual([])
    pass({ ...inputs, sizes: {} })
    expect(vi.mocked(time).mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ['sort-slow', { entries: 0, trigger: 'listing' }],
      ['sort-slow', { entries: 0, trigger: 'sizes' }]
    ])
  })
})
