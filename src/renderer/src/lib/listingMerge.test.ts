import { describe, expect, it } from 'vitest'
import type { DirListing, ViewerFile } from '@shared/types'
import { applyDetails, carryDetails, detailsPending } from './listingMerge'
import { sortFiles } from './sortPrefs'
import { addRestoredTab, newTab, type Tab } from './tabs'
import { smallFolderChildren } from './useListingPrefetch'

const file = (name: string, size?: number, mtimeMs?: number): ViewerFile => ({
  path: `C:\\x\\${name}`,
  name,
  ext: '.txt',
  kind: 'text',
  ...(size === undefined ? {} : { size, mtimeMs: mtimeMs ?? 1 })
})

describe('names first, then details (#271)', () => {
  it('fills a names-only listing in place and completes it on the last patch', () => {
    const names: DirListing = { folders: [], files: [file('a'), file('b')], complete: false }
    const half = applyDetails(names, {
      path: 'C:\\x',
      files: [{ path: 'c:\\x\\a', size: 5, mtimeMs: 9 }],
      done: false
    })
    expect(half.files.map((f) => f.size)).toEqual([5, undefined])
    expect(half.complete).toBe(false)
    expect(detailsPending(half)).toBe(true)
    const done = applyDetails(half, {
      path: 'C:\\x',
      files: [{ path: 'C:\\x\\b', size: 0, mtimeMs: 2 }],
      done: true
    })
    expect(done.files.map((f) => f.size)).toEqual([5, 0])
    expect(done.complete).toBeUndefined()
    expect(detailsPending(done)).toBe(false)
    // The rows themselves are the same objects where nothing changed: React
    // keys by path, so the selection and the scroll have nothing to lose.
    expect(done.files[0]).toBe(half.files[0])
  })

  it('a revisit keeps the sizes it knew; a new file stays blank until its patch', () => {
    const before: DirListing = { folders: [], files: [file('a', 5), file('gone', 1)] }
    const fresh: DirListing = { folders: [], files: [file('a'), file('new')], complete: false }
    const carried = carryDetails(before, fresh)
    expect(carried.files.map((f) => [f.name, f.size])).toEqual([
      ['a', 5],
      ['new', undefined]
    ])
  })

  it('a size sort waits for every size, in name order, never counting a blank as 0', () => {
    const files = [file('c', 1), file('a'), file('b', 3)]
    expect(sortFiles(files, 'size', 'desc').map((f) => f.name)).toEqual(['a', 'b', 'c'])
    const known = [file('c', 1), file('a', 2), file('b', 3)]
    expect(sortFiles(known, 'size', 'desc').map((f) => f.name)).toEqual(['b', 'a', 'c'])
  })
})

describe('restored tabs go back to their saved place (#271)', () => {
  const payload = (order: number) => ({
    root: `C:\\t${order}`,
    files: [],
    index: -1,
    restore: true,
    restoreTabId: `t${order}`,
    restoreOrder: order
  })

  it('whatever order the payloads arrive in', () => {
    const orders = new Map<string, number>()
    let tabs: Tab[] = []
    for (const order of [2, 0, 3, 1]) {
      tabs = addRestoredTab(tabs, payload(order), 'x', (id) => orders.get(id)).tabs
      orders.set(`t${order}`, order)
    }
    expect(tabs.map((t) => t.id)).toEqual(['t0', 't1', 't2', 't3'])
  })

  it('never moves past a tab with no saved place', () => {
    const own = newTab({ root: 'C:\\own', files: [], index: -1 }, 'own')
    const tabs = addRestoredTab([own], payload(0), 'x', () => undefined).tabs
    expect(tabs.map((t) => t.id)).toEqual(['own', 't0'])
  })
})

describe('reading ahead', () => {
  it('only a small folder offers its subfolders, at most twelve', () => {
    const folders = Array.from({ length: 20 }, (_, i) => ({ path: `C:\\x\\${i}`, name: `${i}` }))
    expect(smallFolderChildren({ folders, files: [] })).toHaveLength(12)
    expect(smallFolderChildren({ folders, files: Array.from({ length: 11 }, (_, i) => file(`${i}`)) })).toEqual([])
    expect(smallFolderChildren(null)).toEqual([])
  })
})
