import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderSizeResult } from '@shared/folderSize'
import { FolderSizeCache } from './folderSizeCache'

let box: string
let root: string
let directory: string
const controller = (): AbortController => new AbortController()
const result = (bytes: number): FolderSizeResult => ({
  bytes,
  files: 1,
  folders: 0,
  unreadable: 0,
  skippedLinks: 0,
  truncated: false
})

beforeEach(async () => {
  box = await mkdtemp(join(tmpdir(), 'prism-size-cache-'))
  root = join(box, 'root')
  directory = join(box, 'cache')
  await mkdir(root)
  await writeFile(join(root, 'data'), Buffer.alloc(13))
})
afterEach(async () => {
  await rm(box, { recursive: true, force: true })
})

describe('persistent folder size cache', () => {
  it('reuses a saved total in another process instance without scanning', async () => {
    const first = new FolderSizeCache({ directory })
    expect(await first.get(root, controller().signal)).toMatchObject({
      bytes: 13,
      source: 'filesystem'
    })
    const scan = vi.fn().mockResolvedValue(null)
    const next = new FolderSizeCache({ directory, scan })
    expect(await next.get(root, controller().signal)).toMatchObject({ bytes: 13, stale: false })
    expect(scan).not.toHaveBeenCalled()
  })

  it('emits an expired total immediately, then refreshes nested edits with unchanged root mtime', async () => {
    let now = 1000
    const cache = new FolderSizeCache({ directory, now: () => now, maxAgeMs: 100 })
    await cache.get(root, controller().signal)
    await writeFile(join(root, 'data'), Buffer.alloc(27))
    now += 101
    const update = vi.fn()
    expect(await cache.get(root, controller().signal, update)).toMatchObject({
      bytes: 27,
      stale: false
    })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ bytes: 13, stale: true }))
  })

  it('hydrates every cached row without waiting for uncached recursive work', async () => {
    const cache = new FolderSizeCache({ directory })
    await cache.get(root, controller().signal)
    const missing = join(box, 'missing')
    expect(await cache.readCached([missing, root])).toEqual({
      [root]: expect.objectContaining({ bytes: 13 })
    })
  })

  it('invalidates changed ancestors across instances while keeping unrelated sizes fresh', async () => {
    const other = join(box, 'other')
    await mkdir(other)
    const first = new FolderSizeCache({ directory })
    await first.get(root, controller().signal)
    await first.get(other, controller().signal)
    const second = new FolderSizeCache({ directory })
    await second.invalidate([join(root, 'data')])
    const cached = await first.readCached([root, other])
    expect(cached[root].stale).toBe(true)
    expect(cached[other].stale).toBe(false)
  })

  it('keeps partial totals partial across restart and stale refresh failure', async () => {
    const partial = { ...result(5), unreadable: 2, skippedLinks: 1, truncated: true }
    const first = new FolderSizeCache({ directory, scan: vi.fn().mockResolvedValue(partial) })
    await first.get(root, controller().signal)
    const next = new FolderSizeCache({
      directory,
      scan: vi.fn().mockResolvedValue(null),
      maxAgeMs: 0
    })
    expect(await next.get(root, controller().signal)).toMatchObject({ ...partial, stale: true })
  })

  it('shares a running calculation and does not let one consumer cancel the other', async () => {
    let finish!: (size: FolderSizeResult) => void
    const scan = vi.fn<(path: string, signal: AbortSignal) => Promise<FolderSizeResult>>(
      () =>
        new Promise<FolderSizeResult>((resolve) => {
          finish = resolve
        })
    )
    const cache = new FolderSizeCache({ directory, scan })
    const one = controller()
    const two = controller()
    const first = cache.get(root, one.signal)
    const second = cache.get(root, two.signal)
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1))
    // Wait for both independent disk cache reads to join the shared calculation.
    await new Promise((resolve) => setTimeout(resolve, 20))
    one.abort()
    expect(await first).toBeNull()
    expect(scan.mock.calls[0][1].aborted).toBe(false)
    finish(result(13))
    expect(await second).toMatchObject({ bytes: 13 })
  })

  it('aborts shared work after the last consumer leaves and never stores it', async () => {
    let finish!: (size: FolderSizeResult) => void
    const scan = vi.fn<(path: string, signal: AbortSignal) => Promise<FolderSizeResult>>(
      () =>
        new Promise<FolderSizeResult>((resolve) => {
          finish = resolve
        })
    )
    const cache = new FolderSizeCache({ directory, scan })
    const consumer = controller()
    const pending = cache.get(root, consumer.signal)
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce())
    consumer.abort()
    expect(await pending).toBeNull()
    expect(scan.mock.calls[0][1].aborted).toBe(true)
    finish(result(13))
    expect(await cache.readCached([root])).toEqual({})
  })

  it('prefers indexed totals and marks their coverage and unknown counts', async () => {
    const scan = vi.fn().mockResolvedValue(result(50))
    const indexedSizes = vi.fn().mockResolvedValue(new Map([[root, { bytes: 23 }]]))
    const cache = new FolderSizeCache({ directory, indexedSizes, scan })
    expect(await cache.get(root, controller().signal)).toMatchObject({
      bytes: 23,
      source: 'index',
      countsKnown: false
    })
    expect(scan).not.toHaveBeenCalled()
  })

  it('warms a listing in one bulk lookup and gets do not launch duplicate queries', async () => {
    const other = join(box, 'other')
    await mkdir(other)
    const indexedSizes = vi.fn(
      async (paths: readonly string[]) => new Map(paths.map((path) => [path, { bytes: 8 }]))
    )
    const scan = vi.fn().mockResolvedValue(null)
    const cache = new FolderSizeCache({ directory, indexedSizes, scan })
    const bulk = cache.prefetchIndexed([root, other])
    const values = await Promise.all([
      cache.get(root, controller().signal),
      cache.get(other, controller().signal)
    ])
    await bulk
    expect(values.map((value) => value?.bytes)).toEqual([8, 8])
    expect(indexedSizes).toHaveBeenCalledOnce()
    expect(scan).not.toHaveBeenCalled()
  })

  it('falls back safely for unavailable or missing indexed folder totals', async () => {
    const cache = new FolderSizeCache({
      directory,
      indexedSizes: vi.fn().mockResolvedValue(new Map())
    })
    expect(await cache.get(root, controller().signal)).toMatchObject({
      bytes: 13,
      source: 'filesystem'
    })
  })

  it('releases the first indexed batch while a later batch is still loading', async () => {
    const paths = await Promise.all(
      Array.from({ length: 64 }, async (_, index) => {
        const path = join(root, String(index))
        await mkdir(path)
        return path
      })
    )
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const indexedSizes = vi.fn(async (batch: readonly string[]) => {
      if (batch.some((path) => path.endsWith(`${process.platform === 'win32' ? '\\' : '/'}32`)))
        await gate
      return new Map(batch.map((path) => [path, { bytes: 8 }]))
    })
    const cache = new FolderSizeCache({ directory, indexedSizes })
    const all = cache.prefetchIndexed(paths)
    let first: FolderSizeResult | null | undefined
    let later: FolderSizeResult | null | undefined
    const firstRead = cache.get(paths[0], controller().signal).then((value) => {
      first = value
    })
    const laterRead = cache.get(paths[63], controller().signal).then((value) => {
      later = value
    })
    try {
      await vi.waitFor(() => expect(first?.bytes).toBe(8))
      expect(later).toBeUndefined()
      expect(indexedSizes).toHaveBeenCalledTimes(2)
      expect(indexedSizes.mock.calls.every(([batch]) => batch.length <= 32)).toBe(true)
    } finally {
      release()
      await Promise.all([all, firstRead, laterRead])
    }
    expect(later?.bytes).toBe(8)
  })

  it('moves a requested visible folder batch ahead of untouched queued batches', async () => {
    const paths = await Promise.all(
      Array.from({ length: 128 }, async (_, index) => {
        const path = join(root, String(index))
        await mkdir(path)
        return path
      })
    )
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    let calls = 0
    const indexedSizes = vi.fn(async (batch: readonly string[]) => {
      if (++calls <= 2) await gate
      return new Map(batch.map((path) => [path, { bytes: 8 }]))
    })
    const cache = new FolderSizeCache({ directory, indexedSizes })
    const all = cache.prefetchIndexed(paths)
    await vi.waitFor(() => expect(indexedSizes).toHaveBeenCalledTimes(2))
    const visible = cache.get(paths[127], controller().signal)
    // The get performs root authorization/cache reads before prioritizing.
    await new Promise((resolveWait) => setTimeout(resolveWait, 30))
    release()
    await Promise.all([all, visible])
    expect(
      indexedSizes.mock.calls[2][0].some((path) =>
        path.endsWith(`${process.platform === 'win32' ? '\\' : '/'}127`)
      )
    ).toBe(true)
  })

  it('does not stamp an old index answer as fresh immediately after a file mutation', async () => {
    const indexedSizes = vi.fn(
      async (paths: readonly string[]) => new Map(paths.map((path) => [path, { bytes: 13 }]))
    )
    const cache = new FolderSizeCache({ directory, indexedSizes })
    expect(await cache.get(root, controller().signal)).toMatchObject({ bytes: 13, source: 'index' })
    await writeFile(join(root, 'data'), Buffer.alloc(39))
    await cache.invalidate([join(root, 'data')])
    await cache.prefetchIndexed([root])
    expect(await cache.get(root, controller().signal)).toMatchObject({
      bytes: 39,
      source: 'filesystem',
      stale: false
    })
    expect(indexedSizes).toHaveBeenCalledOnce()
  })

  it('keeps the index settling guard when marker overflow evicts a changed path', async () => {
    const indexedSizes = vi.fn(
      async (paths: readonly string[]) => new Map(paths.map((path) => [path, { bytes: 13 }]))
    )
    const cache = new FolderSizeCache({ directory, indexedSizes })
    await cache.get(root, controller().signal)
    await writeFile(join(root, 'data'), Buffer.alloc(39))
    await cache.invalidate([join(root, 'data')])
    const markers = join(directory, 'invalidations')
    const [oldMarker] = await readdir(markers)
    await utimes(join(markers, oldMarker), new Date(0), new Date(0))
    await cache.invalidate(Array.from({ length: 128 }, (_, index) => join(box, `other-${index}`)))
    expect(await readdir(markers)).not.toContain(oldMarker)
    await cache.prefetchIndexed([root])
    expect(await cache.get(root, controller().signal)).toMatchObject({
      bytes: 39,
      source: 'filesystem',
      stale: false
    })
    expect(indexedSizes).toHaveBeenCalledOnce()
  })

  it('rejects links and paths through links before reading or querying cached totals', async () => {
    const linked = join(box, 'link')
    await symlink(root, linked, 'junction')
    const nested = join(root, 'nested')
    await mkdir(nested)
    const indexedSizes = vi.fn().mockResolvedValue(new Map())
    const cache = new FolderSizeCache({ directory, indexedSizes })
    expect(await cache.get(linked, controller().signal)).toBeNull()
    expect(await cache.get(join(linked, 'nested'), controller().signal)).toBeNull()
    expect(await cache.get('relative', controller().signal)).toBeNull()
    expect(indexedSizes).not.toHaveBeenCalled()
  })

  it('does not publish an in-flight total as fresh after a concurrent invalidation', async () => {
    let finish!: (size: FolderSizeResult) => void
    const scan = vi.fn(
      () =>
        new Promise<FolderSizeResult>((resolve) => {
          finish = resolve
        })
    )
    const cache = new FolderSizeCache({ directory, scan })
    const pending = cache.get(root, controller().signal)
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce())
    await new FolderSizeCache({ directory }).invalidate([join(root, 'data')])
    finish(result(13))
    expect(await pending).toMatchObject({ stale: true })
    expect(await cache.readCached([root])).toEqual({})
  })

  it('writes different folders concurrently without losing either persisted entry', async () => {
    const other = join(box, 'other')
    await mkdir(other)
    await Promise.all([
      new FolderSizeCache({ directory }).get(root, controller().signal),
      new FolderSizeCache({ directory }).get(other, controller().signal)
    ])
    const loaded = await new FolderSizeCache({ directory }).readCached([root, other])
    expect(Object.keys(loaded)).toHaveLength(2)
  })

  it('bounds stored folder records', async () => {
    const paths = await Promise.all(
      [0, 1, 2, 3].map(async (index) => {
        const path = join(root, String(index))
        await mkdir(path)
        return path
      })
    )
    const cache = new FolderSizeCache({ directory, maxEntries: 2 })
    for (const path of paths) await cache.get(path, controller().signal)
    expect((await readdir(directory)).filter((name) => name.endsWith('.json'))).toHaveLength(2)
  })
})
