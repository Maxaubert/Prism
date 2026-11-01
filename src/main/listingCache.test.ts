import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '@shared/types'
import {
  cacheKey,
  createListingCache as makeListingCache,
  decodeListing,
  encodeListing,
  evictionOrder,
  listingSignature,
  type IndexEntry
} from './listingCache'

let box: string
/** Every cache a test made, waited for before its folder goes: a test that
 *  ended with a write in flight had the folder removed under it (EBUSY on
 *  the CI runner, 2026-10-14). */
let made: ReturnType<typeof makeListingCache>[] = []
const createListingCache = (...a: Parameters<typeof makeListingCache>): ReturnType<typeof makeListingCache> => {
  const cache = makeListingCache(...a)
  made.push(cache)
  return cache
}
beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), 'prism-listing-cache-'))
  made = []
})
afterEach(async () => {
  await Promise.all(made.map((c) => c.idle()))
  rmSync(box, { recursive: true, force: true })
})

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

// A write is waited for by `idle()`, never by a sleep: 60 ms was not enough
// for a listing write on a busy CI runner (2026-10-30, 2026-11-01). A file
// a forget deletes is fire-and-forget in the cache, so its going is waited
// for by looking, bounded.
const gone = (file: string): Promise<void> =>
  vi.waitFor(() => expect(existsSync(file)).toBe(false), { timeout: 5000, interval: 10 })

describe('the stored form', () => {
  it('round-trips a listing, rebuilding paths, extensions and kinds', () => {
    const stored = encodeListing('C:\\A', listing('C:\\A', 2, 3), 77, 5)
    const back = decodeListing(JSON.stringify(stored), 'c:/a/')
    expect(back?.partial).toBe(false)
    expect(back?.folderMtimeMs).toBe(77)
    expect(back?.listing).toEqual(listing('C:\\A', 2, 3))
  })

  it("keeps folders' dates, and reads a cache written before they were kept (#285)", () => {
    const dated = listing('C:\\A', 2, 1)
    dated.folders = dated.folders.map((f, i) => ({ ...f, mtimeMs: 500 + i }))
    const stored = encodeListing('C:\\A', dated, 1, 1)
    expect(stored.folderTimes).toEqual([500, 501])
    expect(decodeListing(JSON.stringify(stored))?.listing).toEqual(dated)
    // Old form: no dates, still read, folders simply undated.
    const old = { ...stored, folderTimes: undefined }
    expect(decodeListing(JSON.stringify(old))?.listing.folders[0]).toEqual({ path: 'C:\\A\\d0', name: 'd0' })
    // Dates that do not line up with the names are dropped, not guessed.
    const bad = { ...stored, folderTimes: [500] }
    expect(decodeListing(JSON.stringify(bad))?.listing.folders[1].mtimeMs).toBeUndefined()
    // A listing with any undated folder stores none.
    expect(encodeListing('C:\\A', listing('C:\\A', 2, 0), 1, 1).folderTimes).toBeUndefined()
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
    await one.idle()
    one.flush()
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
    const two = createListingCache({ directory: dir })
    two.load()
    await two.idle() // the held texts are read in behind the index
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
    await cache.idle()
    expect(cache.entries()).toEqual([])
  })

  it('evicts past the folder budget and deletes the evicted file', async () => {
    const dir = join(box, 'cache')
    let t = 0
    const cache = createListingCache({ directory: dir, maxFolders: 2, now: () => ++t })
    cache.put('C:\\A', listing('C:\\A', 1, 0), 1)
    cache.put('C:\\B', listing('C:\\B', 1, 0), 1)
    await cache.idle()
    cache.put('C:\\C', listing('C:\\C', 1, 0), 1)
    await cache.idle()
    expect(cache.entries().map((e) => e.path).sort()).toEqual(['C:\\B', 'C:\\C'])
    await gone(join(dir, `${cacheKey('C:\\A')}.json`))
  })

  it('keeps pinned places past the budget', async () => {
    let t = 0
    const cache = createListingCache({ directory: join(box, 'cache'), maxFolders: 1, now: () => ++t })
    cache.pin(['C:\\Home'])
    cache.put('C:\\Home', listing('C:\\Home', 1, 0), 1)
    cache.put('C:\\Other', listing('C:\\Other', 1, 0), 1)
    expect(cache.entries().map((e) => e.path)).toEqual(['C:\\Home'])
  })

  it('a refresh that changed nothing writes nothing (perf review #10)', async () => {
    let t = 0
    const cache = createListingCache({ directory: join(box, 'cache'), now: () => ++t })
    cache.put('C:\\A', listing('C:\\A', 1, 2), 5)
    await cache.idle()
    const first = cache.entries()[0].savedAt
    cache.put('C:\\A', listing('C:\\A', 1, 2), 5)
    expect(cache.entries()[0].savedAt).toBe(first)
    // A changed row, or the folder's own date, writes again.
    cache.put('C:\\A', listing('C:\\A', 1, 3), 5)
    const second = cache.entries()[0].savedAt
    expect(second).toBeGreaterThan(first)
    cache.put('C:\\A', listing('C:\\A', 1, 3), 6)
    expect(cache.entries()[0].savedAt).toBeGreaterThan(second)
    // A forgotten entry is written again even with the same rows.
    cache.drop('C:\\A')
    cache.put('C:\\A', listing('C:\\A', 1, 3), 6)
    expect(cache.entries()).toHaveLength(1)
  })

  it('signs a listing by its rows', () => {
    const a = listing('C:\\A', 1, 2)
    expect(listingSignature(a, 1)).toBe(listingSignature(listing('C:\\A', 1, 2), 1))
    expect(listingSignature(a, 1)).not.toBe(listingSignature(a, 2))
    expect(listingSignature(a, 1)).not.toBe(listingSignature(listing('C:\\A', 2, 2), 1))
  })

  it('treats a damaged file as a miss and forgets it', async () => {
    const dir = join(box, 'cache')
    const cache = createListingCache({ directory: dir })
    cache.put('C:\\A', listing('C:\\A', 1, 0), 1)
    await cache.idle()
    writeFileSync(join(dir, `${cacheKey('C:\\A')}.json`), '{"v":1,')
    expect(await cache.readAsync('C:\\A')).toBeNull()
    expect(cache.has('C:\\A')).toBe(false)
  })

  it('switching it off deletes everything kept, and stores nothing until on again', async () => {
    const dir = join(box, 'cache')
    const cache = createListingCache({ directory: dir })
    cache.put('C:\\A', listing('C:\\A', 1, 0), 1)
    await cache.idle()
    cache.flush()
    expect(existsSync(dir)).toBe(true)
    cache.setEnabled(false)
    await cache.idle()
    expect(existsSync(dir)).toBe(false)
    cache.put('C:\\B', listing('C:\\B', 1, 0), 1)
    expect(cache.read('C:\\B')).toBeNull()
    cache.setEnabled(true)
    cache.put('C:\\B', listing('C:\\B', 1, 0), 1)
    await cache.idle()
    expect(cache.read('C:\\B')).not.toBeNull()
  })

  it('sweeps, at the next start, files the index does not name (a kill before the index write)', async () => {
    const dir = join(box, 'cache')
    const one = createListingCache({ directory: dir, indexDelayMs: 1 })
    one.put('C:\\A', listing('C:\\A', 1, 0), 1)
    await one.idle()
    one.flush()
    // Written but never indexed, and a temporary from a write cut short.
    writeFileSync(join(dir, `${cacheKey('C:\\Lost')}.json`), '{}')
    writeFileSync(join(dir, `${cacheKey('C:\\A')}.json.1234.tmp`), '{}')
    const two = createListingCache({ directory: dir })
    two.load()
    await two.sweep() // load starts one; this waits for the folder to be swept
    await two.idle()
    expect(readdirSync(dir).sort()).toEqual([`${cacheKey('C:\\A')}.json`, 'index.json'].sort())
    expect(two.read('C:\\A')).not.toBeNull()
  })

  it('a write that began before a Clear does not land after it', async () => {
    const dir = join(box, 'cache')
    const cache = createListingCache({ directory: dir })
    const before = cache.generation
    expect(await cache.clear()).toBe(true)
    cache.put('C:\\A', listing('C:\\A', 1, 0), 1, before)
    await cache.idle()
    expect(cache.entries()).toEqual([])
    expect(existsSync(dir)).toBe(false)
    cache.put('C:\\A', listing('C:\\A', 1, 0), 1, cache.generation)
    expect(cache.has('C:\\A')).toBe(true)
  })

  it('writes the index off the main thread on its delay, newest last (2026-10-12)', async () => {
    const dir = join(box, 'cache')
    let t = 0
    const cache = createListingCache({ directory: dir, indexDelayMs: 1, now: () => ++t })
    cache.put('C:\\A', listing('C:\\A', 1, 0), 1)
    await cache.idle()
    const first = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
    expect(first.entries.map((e: IndexEntry) => e.path)).toEqual(['C:\\A'])
    // Two changes in quick succession: the file ends with both.
    cache.put('C:\\B', listing('C:\\B', 1, 0), 1)
    const writing = cache.idle() // the index write for B starts now...
    cache.drop('C:\\A') // ...and the drop comes while it runs
    await writing
    await cache.idle()
    const last = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
    expect(last.entries.map((e: IndexEntry) => e.path)).toEqual(['C:\\B'])
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('reads a listing without blocking, counting the hit like the sync read', async () => {
    const dir = join(box, 'cache')
    const cache = createListingCache({ directory: dir })
    cache.put('C:\\A', listing('C:\\A', 1, 2), 9)
    await cache.idle()
    const hit = await cache.readAsync('c:/a')
    expect(hit?.folderMtimeMs).toBe(9)
    expect(hit?.listing.files).toHaveLength(2)
    expect(cache.entries()[0].hits).toBe(2)
    expect(await cache.readAsync('C:\\Missing')).toBeNull()
    writeFileSync(join(dir, `${cacheKey('C:\\A')}.json`), 'nope')
    expect(await cache.readAsync('C:\\A')).toBeNull()
    expect(cache.has('C:\\A')).toBe(false)
  })

  it('a listing kept right after a Clear waits for the delete and survives it', async () => {
    const dir = join(box, 'cache')
    const cache = createListingCache({ directory: dir })
    cache.put('C:\\A', listing('C:\\A', 1, 0), 1)
    await cache.idle()
    const cleared = cache.clear()
    cache.put('C:\\B', listing('C:\\B', 1, 0), 1, cache.generation)
    expect(await cleared).toBe(true)
    await cache.idle()
    expect(existsSync(join(dir, `${cacheKey('C:\\A')}.json`))).toBe(false)
    expect(cache.read('C:\\B')).not.toBeNull()
  })

  it('drops a folder that has gone, file and all', async () => {
    const dir = join(box, 'cache')
    const cache = createListingCache({ directory: dir })
    cache.put('C:\\A', listing('C:\\A', 1, 0), 1)
    await cache.idle()
    cache.drop('c:/a')
    await cache.idle()
    expect(cache.has('C:\\A')).toBe(false)
    await gone(join(dir, `${cacheKey('C:\\A')}.json`))
  })

  it('a second window reads and never writes', async () => {
    const dir = join(box, 'cache')
    const writer = createListingCache({ directory: dir })
    writer.put('C:\\A', listing('C:\\A', 1, 0), 1)
    await writer.idle()
    writer.flush()
    const before = readFileSync(join(dir, 'index.json'), 'utf8')
    const reader = createListingCache({ directory: dir, readOnly: true })
    reader.load()
    await reader.idle()
    expect(reader.read('C:\\A')).not.toBeNull()
    reader.put('C:\\B', listing('C:\\B', 1, 0), 1)
    reader.flush()
    expect(readFileSync(join(dir, 'index.json'), 'utf8')).toBe(before)
  })
})

describe('the same-frame read answers from memory (review, 2026-10-28)', () => {
  it('never reads the disk in the sync read: a folder not held misses, then is read in behind it', async () => {
    const dir = join(box, 'cache')
    const one = createListingCache({ directory: dir, indexDelayMs: 1 })
    one.put('C:\\A', listing('C:\\A', 1, 0), 1)
    one.put('C:\\B', listing('C:\\B', 1, 0), 1)
    await one.idle()
    one.flush()
    // Holds one folder only: the warm-up after load reads in one of the two.
    const two = createListingCache({ directory: dir, maxHeld: 1 })
    two.load()
    await two.idle()
    const first = two.read('C:\\A')
    const other = first ? 'C:\\B' : 'C:\\A'
    if (!first) expect(two.read('C:\\B')).not.toBeNull()
    expect(two.read(other)).toBeNull()
    await two.idle()
    expect(two.read(other)?.path).toBe(other)
  })

  it('serves a put at once, and a hover warms a folder for the click', async () => {
    const dir = join(box, 'cache')
    const one = createListingCache({ directory: dir, indexDelayMs: 1 })
    one.put('C:\\A', listing('C:\\A', 1, 0), 1)
    expect(one.read('C:\\A')).not.toBeNull()
    await one.idle()
    one.flush()
    const two = createListingCache({ directory: dir, maxHeld: 0 })
    two.load()
    await two.idle()
    expect(two.read('C:\\A')).toBeNull()
    const three = createListingCache({ directory: dir, maxHeld: 4 })
    three.load()
    await three.idle()
    three.warm('C:\\A')
    await three.idle()
    expect(three.read('C:\\A')).not.toBeNull()
  })
})

describe('a place inside an archive (#300)', () => {
  it('round-trips, members, packed sizes, folder totals and the archive meta included', () => {
    const base = 'C:\\d\\w.zip\\Wind'
    const archive = {
      container: 'C:\\d\\w.zip',
      base: 'C:\\d\\w.zip',
      chain: ['C:\\d\\w.zip'],
      outer: 'C:\\d\\w.zip',
      inner: 'Wind',
      display: 'w.zip',
      files: 2,
      folders: 1,
      packed: 100,
      unpacked: 300,
      readOnly: false,
      nested: false,
      encryption: 'none' as const
    }
    const l: DirListing = {
      folders: [{ path: `${base}\\src`, name: 'src', mtimeMs: 5, size: 200, items: 3 }],
      files: [
        { path: `${base}\\a.ts`, name: 'a.ts', ext: '.ts', kind: 'text', size: 100, mtimeMs: 7, member: true, packed: 40 }
      ],
      archive
    }
    const back = decodeListing(JSON.stringify(encodeListing(base, l, 9, 1)))
    expect(back?.listing.archive).toEqual(archive)
    expect(back?.listing.files[0]).toMatchObject({ path: `${base}\\a.ts`, member: true, packed: 40 })
    expect(back?.listing.folders[0]).toMatchObject({ path: `${base}\\src`, size: 200, items: 3 })
  })
})
