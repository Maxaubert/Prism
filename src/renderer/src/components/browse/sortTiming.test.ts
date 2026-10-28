import { beforeEach, describe, expect, it, vi } from 'vitest'
import { time } from 'prism-term-core/renderer/lib/diag'
import { createSortPass, sortTrigger, type SortInputs } from './sortTiming'
import { sameOrder } from './entries'

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

describe('an order that cannot move is not sorted again (perf review #11, #20)', () => {
  const folder = (name: string, mtimeMs?: number) => ({ path: `C:\\F\\${name}`, name, mtimeMs })
  const file = (name: string, size?: number, mtimeMs?: number) => ({
    path: `C:\\F\\${name}`,
    name,
    ext: '.txt',
    kind: 'text' as const,
    size,
    mtimeMs
  })
  const names = { folders: [folder('b'), folder('a')], files: [file('z.txt'), file('y.txt')], complete: false }
  const patched = {
    folders: [folder('b', 5), folder('a', 6)],
    files: [file('z.txt', 1, 2), file('y.txt', 3, 4)]
  }
  const base: SortInputs = { listing: names, query: '', sort: { key: 'name', direction: 'asc' }, sizes: {}, dated: false }

  it('refills a Name sort from a details patch, in the same order, with the new details', () => {
    const pass = createSortPass()
    const first = pass(base)
    expect(first.map((e) => e.name)).toEqual(['a', 'b', 'y.txt', 'z.txt'])
    const second = pass({ ...base, listing: patched })
    expect(second.map((e) => e.name)).toEqual(['a', 'b', 'y.txt', 'z.txt'])
    expect(second[2].file?.size).toBe(3)
    expect(second[0].mtimeMs).toBe(6)
    expect(sameOrder(base, { ...base, listing: patched })).toBe(true)
  })

  it('sorts again when a patch can move a row, or the rows changed', () => {
    const byDate = { ...base, sort: { key: 'modified' as const, direction: 'desc' as const } }
    expect(sameOrder(byDate, { ...byDate, listing: patched })).toBe(false)
    const more = { ...patched, files: [...patched.files, file('x.txt', 1, 1)] }
    expect(sameOrder(base, { ...base, listing: more })).toBe(false)
    expect(sameOrder(base, { ...base, query: 'a' })).toBe(false)
  })

  it('a folder-size tick refills every sort but Size, keeping untouched rows', () => {
    const size = (bytes: number) => ({
      bytes,
      files: 1,
      folders: 0,
      unreadable: 0,
      skippedLinks: 0,
      truncated: false,
      countsKnown: true
    })
    const pass = createSortPass()
    const first = pass({ ...base, listing: patched })
    const sizes = { 'C:\\F\\a': size(10) }
    expect(sameOrder({ ...base, listing: patched }, { ...base, listing: patched, sizes })).toBe(true)
    const second = pass({ ...base, listing: patched, sizes })
    expect(second[0].folderSize?.bytes).toBe(10)
    expect(second[1]).toBe(first[1])
    expect(second[2]).toBe(first[2])
    const bySize = { ...base, listing: patched, sort: { key: 'size' as const, direction: 'desc' as const } }
    expect(sameOrder(bySize, { ...bySize, sizes })).toBe(false)
  })
})
