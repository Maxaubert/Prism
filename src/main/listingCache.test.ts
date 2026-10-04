import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DirListing } from '@shared/types'
import {
  cacheKey,
  createListingCache,
  decodeListing,
  encodeListing,
  evictionOrder,
  type IndexEntry
} from './listingCache'

let box: string
beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), 'prism-listing-cache-'))
})
afterEach(() => rmSync(box, { recursive: true, force: true }))

function listing(dir: string, folders: number, files: number): DirListing {
  return {
    folders: Array.from({ length: folders }, (_, i) => ({ path: `${dir}\\d${i}`, name: `d${i}` })),
    files: Array.from({ length: files }, (_, i) => ({
      path: `${dir}\\f${i}.txt`,
      name: `f${i}.txt`,
      ext: '.txt',
      kind: 'text' as const,
      size: i,
      mtimeMs: 1000 + i
    }))
  }
}

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 60))

describe('the stored form', () => {
  it('round-trips a listing, rebuilding paths, extensions and kinds', () => {
    const stored = encodeListing('C:\\A', listing('C:\\A', 2, 3), 77, 5)
    const back = decodeListing(JSON.stringify(stored), 'c:/a/')
    expect(back?.partial).toBe(false)
    expect(back?.folderMtimeMs).toBe(77)
    expect(back?.listing).toEqual(listing('C:\\A', 2, 3))
  })

  it('keeps a drive root joinable', () => {
    const back = decodeListing(JSON.stringify(encodeListing('C:\\', listing('C:', 1, 1), 1, 1)))
    expect(back?.listing.folders[0].path).toBe('C:\\d0')
  })

  it('stores only the first 2000 entries of a big folder, folders first, and says partial', () => {
    const stored = encodeListing('C:\\Big', listing('C:\\Big', 10, 3000), 1, 1, 2000)
    expect(stored.folders).toHaveLength(10)
    expect(stored.files).toHaveLength(1990)
    expect(stored.files[0][0]).toBe('f0.txt')
    expect(decodeListing(JSON.stringify(stored))?.partial).toBe(true)
  })

  it('ignores a corrupt, foreign or wrong-folder file instead of trusting it', () => {
    expect(decodeListing('{not json')).toBeNull()
    expect(decodeListing(JSON.stringify({ v: 2, path: 'C:\\A', folders: [], files: [] }))).toBeNull()
    const escape = { ...encodeListing('C:\\A', listing('C:\\A', 0, 0), 1, 1), folders: ['..\\..\\x'] }
    expect(decodeListing(JSON.stringify(escape))).toBeNull()
    const other = encodeListing('C:\\B', listing('C:\\B', 1, 0), 1, 1)
    expect(decodeListing(JSON.stringify(other), 'C:\\A')).toBeNull()
  })
})

describe('eviction', () => {
  const entry = (key: string, usedAt: number, extra: Partial<IndexEntry> = {}): IndexEntry => ({
    path: key,
    key,
    folderMtimeMs: 0,
    savedAt: usedAt,
    usedAt,
    hits: 1,
    bytes: 10,
    ...extra
  })

  it('drops the least recently used first, down to the folder budget', () => {
    expect(evictionOrder([entry('a', 1), entry('b', 3), entry('c', 2)], 2)).toEqual(['a'])
  })

  it('weighs hits: a folder opened often outlives a newer one opened once', () => {
    const often = entry('often', 1, { hits: 20 })
    const once = entry('once', 2 * 3_600_000)
    expect(evictionOrder([often, once], 1)).toEqual(['once'])
  })

  it('keeps pinned places to the last, and holds the byte budget', () => {
    const pinned = entry('pinned', 0, { pinned: true, bytes: 50 })
    const order = evictionOrder([pinned, entry('x', 5, { bytes: 50 }), entry('y', 6, { bytes: 50 })], 10, 100)
    expect(order).toEqual(['x'])
  })
})

describe('the cache on disk', () => {
  it('writes atomically, reads back after a restart, and counts hits', async () => {
    const dir = join(box, 'cache')
    const one = createListingCache({ directory: dir, indexDelayMs: 1 })
    one.load()
    one.put('C:\\A', listing('C:\\A', 1, 2), 42)
    await settle()
    one.flush()
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
    const two = createListingCache({ directory: dir })
    two.load()
    const hit = two.read('c:\\a')
    expect(hit?.listing.files.map((f) => f.size)).toEqual([0, 1])
    expect(hit?.folderMtimeMs).toBe(42)
    expect(two.entries()[0].hits).toBe(2)
  })

  it('never stores a names-only listing, an unreadable one or a refused drive', async () => {
    const dir = join(box, 'cache')
    const cache = createListingCache({ directory: dir, allowed: (p) => !p.startsWith('\\\\') })
    cache.put('C:\\A', { ...listing('C:\\A', 0, 1), complete: false }, 1)
    cache.put('C:\\B', { folders: [], files: [], unreadable: true }, 1)
    cache.put('\\\\server\\share', listing('\\\\server\\share', 1, 1), 1)
    await settle()
    expect(cache.entries()).toEqual([])
  })

  it('evicts past the folder budget and deletes the evicted file', async () => {
    const dir = join(box, 'cache')
    let t = 0
    const cache = createListingCache({ directory: dir, maxFolders: 2, now: () => ++t })
    cache.put('C:\\A', listing('C:\\A', 1, 0), 1)
    cache.put('C:\\B', listing('C:\\B', 1, 0), 1)
    await settle()
    cache.put('C:\\C', listing('C:\\C', 1, 0), 1)
    await settle()
    expect(cache.entries().map((e) => e.path).sort()).toEqual(['C:\\B', 'C:\\C'])
    expect(existsSync(join(dir, `${cacheKey('C:\\A')}.json`))).toBe(false)
  })

  it('keeps pinned places past the budget', async () => {
    let t = 0
    const cache = createListingCache({ directory: join(box, 'cache'), maxFolders: 1, now: () => ++t })
    cache.pin(['C:\\Home'])
    cache.put('C:\\Home', listing('C:\\Home', 1, 0), 1)
    cache.put('C:\\Other', listing('C:\\Other', 1, 0), 1)
    expect(cache.entries().map((e) => e.path)).toEqual(['C:\\Home'])
  })

  it('treats a damaged file as a miss and forgets it', async () => {
    const dir = join(box, 'cache')
    const cache = createListingCache({ directory: dir })
    cache.put('C:\\A', listing('C:\\A', 1, 0), 1)
    await settle()
    writeFileSync(join(dir, `${cacheKey('C:\\A')}.json`), '{"v":1,')
    expect(cache.read('C:\\A')).toBeNull()
    expect(cache.has('C:\\A')).toBe(false)
  })

  it('switching it off deletes everything kept, and stores nothing until on again', async () => {
    const dir = join(box, 'cache')
    const cache = createListingCache({ directory: dir })
    cache.put('C:\\A', listing('C:\\A', 1, 0), 1)
    await settle()
    cache.flush()
    expect(existsSync(dir)).toBe(true)
    cache.setEnabled(false)
    expect(existsSync(dir)).toBe(false)
    cache.put('C:\\B', listing('C:\\B', 1, 0), 1)
    expect(cache.read('C:\\B')).toBeNull()
    cache.setEnabled(true)
    cache.put('C:\\B', listing('C:\\B', 1, 0), 1)
    await settle()
    expect(cache.read('C:\\B')).not.toBeNull()
  })

  it('a second window reads and never writes', async () => {
    const dir = join(box, 'cache')
    const writer = createListingCache({ directory: dir })
    writer.put('C:\\A', listing('C:\\A', 1, 0), 1)
    await settle()
    writer.flush()
    const before = readFileSync(join(dir, 'index.json'), 'utf8')
    const reader = createListingCache({ directory: dir, readOnly: true })
    reader.load()
    expect(reader.read('C:\\A')).not.toBeNull()
    reader.put('C:\\B', listing('C:\\B', 1, 0), 1)
    reader.flush()
    expect(readFileSync(join(dir, 'index.json'), 'utf8')).toBe(before)
  })
})
