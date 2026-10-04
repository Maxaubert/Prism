import { describe, expect, it, vi } from 'vitest'
import type { BrowseDirectory } from '@shared/browse'
import { createDirectoryRequests, createVisitedDirectories } from './visitedDirectories'

function withFiles(
  path: string,
  files: Array<[string, number?, number?]>,
  complete = true
): BrowseDirectory {
  return {
    path,
    listing: {
      folders: [],
      files: files.map(([name, size, mtimeMs]) => ({
        path: `${path}\\${name}`,
        name,
        ext: '.txt',
        kind: 'text' as const,
        ...(size === undefined ? {} : { size, mtimeMs })
      })),
      ...(complete ? {} : { complete: false })
    }
  }
}

function directory(path: string, rows = 1): BrowseDirectory {
  return {
    path,
    listing: {
      files: [],
      folders: Array.from({ length: rows }, (_, index) => ({
        name: `${index}`,
        path: `${path}\\${index}`
      }))
    }
  }
}

describe('visited directory snapshots', () => {
  it('reuses Windows path spellings and replaces a stale listing with fresh contents', () => {
    const cache = createVisitedDirectories()
    cache.remember(directory('C:\\Books', 1))
    expect(cache.get('c:/books/')?.listing.folders).toHaveLength(1)
    cache.remember(directory('C:\\Books', 2))
    expect(cache.get('C:\\Books')?.listing.folders).toHaveLength(2)
  })

  // #271: the snapshots used to belong to the tab in front and were cleared
  // at every switch, so the tab switched to had nothing to draw.
  it('is shared by every tab: a folder one tab read is a hit for the next', () => {
    const cache = createVisitedDirectories()
    cache.remember(directory('C:\\Books'))
    expect(cache.get('C:\\Books')).not.toBeNull()
  })

  it('bounds both retained directories and total rows, keeping recent refreshes', () => {
    const cache = createVisitedDirectories(2, 5)
    cache.remember(directory('C:\\A', 2))
    cache.remember(directory('C:\\B', 2))
    cache.remember(directory('C:\\A', 2))
    cache.remember(directory('C:\\C', 2))
    expect(cache.get('C:\\A')).not.toBeNull()
    expect(cache.get('C:\\B')).toBeNull()
    cache.remember(directory('C:\\C', 4))
    expect(cache.get('C:\\A')).toBeNull()
    cache.remember(directory('C:\\Large', 6))
    expect(cache.get('C:\\Large')).toBeNull()
    expect(cache.get('C:\\C')).not.toBeNull()
  })

  it('removes snapshots when a folder disappears or becomes unreadable', () => {
    const cache = createVisitedDirectories()
    cache.remember(directory('C:\\A'))
    cache.forget('c:/a/')
    expect(cache.get('C:\\A')).toBeNull()
    cache.remember(directory('C:\\A'))
    cache.remember({
      path: 'C:\\A',
      listing: { files: [], folders: [], unreadable: true }
    })
    expect(cache.get('C:\\A')).toBeNull()
  })

  it('keeps known sizes when a names-only answer replaces a complete one', () => {
    const cache = createVisitedDirectories()
    cache.remember(withFiles('C:\\A', [['a.txt', 5, 9]]))
    const merged = cache.remember(withFiles('C:\\A', [['a.txt'], ['b.txt']], false))
    expect(merged.listing.files.map((f) => f.size)).toEqual([5, undefined])
    expect(merged.listing.complete).toBe(false)
  })

  it('lays details over a held folder, and keeps early ones for the answer they belong to', () => {
    const cache = createVisitedDirectories()
    expect(
      cache.patch({ path: 'C:\\A', files: [{ path: 'C:\\A\\a.txt', size: 7, mtimeMs: 1 }], done: false })
    ).toBeNull()
    const merged = cache.remember(withFiles('C:\\A', [['a.txt'], ['b.txt']], false))
    expect(merged.listing.files[0].size).toBe(7)
    const done = cache.patch({
      path: 'c:/a',
      files: [{ path: 'C:\\A\\b.txt', size: 2, mtimeMs: 3 }],
      done: true
    })
    expect(done?.listing.files.map((f) => f.size)).toEqual([7, 2])
    expect(done?.listing.complete).toBeUndefined()
  })
})

describe('directory reads in flight', () => {
  it('shares a navigation read with its location effect but never grants another tab implicitly', async () => {
    let release!: (value: BrowseDirectory) => void
    const first = new Promise<BrowseDirectory>((resolve) => {
      release = resolve
    })
    const read = vi.fn().mockReturnValue(first)
    const request = createDirectoryRequests(read)
    const navigation = request('first', 'C:\\Books', '0:0')
    expect(request('first', 'c:/books/', '0:0')).toBe(navigation)
    request('second', 'C:\\Books', '0:0')
    expect(read).toHaveBeenCalledTimes(2)
    release(directory('C:\\Books'))
    await navigation
    request('first', 'C:\\Books', '0:0')
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('allows a fresh attempt after a failed read', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(directory('C:\\Books'))
    const request = createDirectoryRequests(read)
    await expect(request('first', 'C:\\Books', '0:0')).rejects.toThrow('offline')
    await expect(request('first', 'C:\\Books', '0:0')).resolves.toMatchObject({ path: 'C:\\Books' })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('starts a fresh generation during an older read without disturbing same-generation deduplication', async () => {
    let releaseOld!: (value: BrowseDirectory) => void
    let releaseFresh!: (value: BrowseDirectory) => void
    const old = new Promise<BrowseDirectory>((resolve) => {
      releaseOld = resolve
    })
    const fresh = new Promise<BrowseDirectory>((resolve) => {
      releaseFresh = resolve
    })
    const read = vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(fresh)
    const request = createDirectoryRequests(read)
    const beforeMutation = request('first', 'C:\\Books', '0:0')
    const afterMutation = request('first', 'C:\\Books', '1:0')
    expect(afterMutation).not.toBe(beforeMutation)
    expect(request('first', 'c:/books/', '1:0')).toBe(afterMutation)
    expect(read).toHaveBeenCalledTimes(2)
    releaseOld(directory('C:\\Books', 1))
    await beforeMutation
    // Finishing the previous generation must not remove the current pending read.
    expect(request('first', 'C:\\Books', '1:0')).toBe(afterMutation)
    releaseFresh(directory('C:\\Books', 2))
    expect((await afterMutation)?.listing.folders).toHaveLength(2)
  })
})
