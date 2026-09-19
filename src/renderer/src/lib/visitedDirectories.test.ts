import { describe, expect, it, vi } from 'vitest'
import type { BrowseDirectory } from '@shared/browse'
import { createDirectoryRequests, createVisitedDirectories } from './visitedDirectories'

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
    cache.use('explorer')
    cache.remember('explorer', directory('C:\\Books', 1))
    expect(cache.get('explorer', 'c:/books/')?.listing.folders).toHaveLength(1)
    cache.remember('explorer', directory('C:\\Books', 2))
    expect(cache.get('explorer', 'C:\\Books')?.listing.folders).toHaveLength(2)
  })

  it('discards the old tab snapshots and refuses a late result from that tab', () => {
    const cache = createVisitedDirectories()
    cache.use('first')
    cache.remember('first', directory('C:\\Books'))
    cache.use('second')
    cache.remember('first', directory('C:\\Books'))
    expect(cache.get('second', 'C:\\Books')).toBeNull()
    cache.use('first')
    expect(cache.get('first', 'C:\\Books')).toBeNull()
    cache.use(undefined)
    expect(cache.get('first', 'C:\\Books')).toBeNull()
  })

  it('bounds both retained directories and total rows, keeping recent refreshes', () => {
    const cache = createVisitedDirectories(2, 5)
    cache.use('explorer')
    cache.remember('explorer', directory('C:\\A', 2))
    cache.remember('explorer', directory('C:\\B', 2))
    cache.remember('explorer', directory('C:\\A', 2))
    cache.remember('explorer', directory('C:\\C', 2))
    expect(cache.get('explorer', 'C:\\A')).not.toBeNull()
    expect(cache.get('explorer', 'C:\\B')).toBeNull()
    cache.remember('explorer', directory('C:\\C', 4))
    expect(cache.get('explorer', 'C:\\A')).toBeNull()
    cache.remember('explorer', directory('C:\\Large', 6))
    expect(cache.get('explorer', 'C:\\Large')).toBeNull()
    expect(cache.get('explorer', 'C:\\C')).not.toBeNull()
  })

  it('removes snapshots when a folder disappears or becomes unreadable', () => {
    const cache = createVisitedDirectories()
    cache.use('explorer')
    cache.remember('explorer', directory('C:\\A'))
    cache.forget('explorer', 'c:/a/')
    expect(cache.get('explorer', 'C:\\A')).toBeNull()
    cache.remember('explorer', directory('C:\\A'))
    cache.remember('explorer', {
      path: 'C:\\A',
      listing: { files: [], folders: [], unreadable: true }
    })
    expect(cache.get('explorer', 'C:\\A')).toBeNull()
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
