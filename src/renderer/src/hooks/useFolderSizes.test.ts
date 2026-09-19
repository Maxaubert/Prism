import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderSizeResult } from '@shared/folderSize'
import { createVisibleFolderSizes } from './useFolderSizes'

const size = (bytes: number): FolderSizeResult => ({
  bytes,
  files: 1,
  folders: 0,
  unreadable: 0,
  skippedLinks: 0,
  truncated: false
})

function fixture(paths: string[]) {
  const requests: {
    path: string
    id: string
    resolve: (value: FolderSizeResult | null) => void
  }[] = []
  let progress!: (event: { requestId: string; result: FolderSizeResult }) => void
  const unsubscribe = vi.fn()
  const api = {
    folderSize: vi.fn(
      (path: string, id: string) =>
        new Promise<FolderSizeResult | null>((resolve) => {
          requests.push({ path, id, resolve })
        })
    ),
    folderSizesCached: vi
      .fn<(paths: string[]) => Promise<Record<string, FolderSizeResult>>>()
      .mockResolvedValue({}),
    cancelFolderSize: vi.fn(),
    onFolderSizeProgress: vi.fn((callback: typeof progress) => {
      progress = callback
      return unsubscribe
    })
  }
  const publish = vi.fn()
  const controller = createVisibleFolderSizes(paths, api, publish)
  return {
    controller,
    api,
    publish,
    requests,
    unsubscribe,
    progress: (id: string, bytes: number) => progress({ requestId: id, result: size(bytes) })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('visible folder size requests', () => {
  it('does no work for an empty viewport and requests only visible folders in a huge listing', async () => {
    const paths = Array.from({ length: 10_000 }, (_, index) => `folder-${index}`)
    const test = fixture(paths)
    test.controller.setVisible([])
    expect(test.api.folderSize).not.toHaveBeenCalled()
    expect(test.api.folderSizesCached).not.toHaveBeenCalled()
    test.controller.setVisible([paths[9998], paths[9999], 'outside'])
    expect(test.requests.map(({ path }) => path)).toEqual(paths.slice(9998))
    expect(test.api.folderSizesCached).toHaveBeenCalledWith(paths.slice(9998))
    test.requests.forEach((request) => request.resolve(size(4)))
    await vi.advanceTimersByTimeAsync(16)
    expect(test.requests).toHaveLength(2)
    test.controller.dispose()
  })

  it('keeps at most two visible requests active and cancels rows leaving the viewport', async () => {
    const test = fixture(['a', 'b', 'c', 'd'])
    test.controller.setVisible(['a', 'b', 'c'])
    expect(test.requests.map(({ path }) => path)).toEqual(['a', 'b'])
    test.requests[0].resolve(size(1))
    await vi.advanceTimersByTimeAsync(16)
    expect(test.requests.map(({ path }) => path)).toEqual(['a', 'b', 'c'])
    test.controller.setVisible(['c', 'd'])
    expect(test.api.cancelFolderSize).toHaveBeenCalledExactlyOnceWith(test.requests[1].id)
    expect(test.requests.map(({ path }) => path)).toEqual(['a', 'b', 'c', 'd'])
    test.controller.dispose()
  })

  it('retains completed values while scrolling and does not rescan them on return', async () => {
    const test = fixture(['a', 'b'])
    test.controller.setVisible(['a'])
    test.requests[0].resolve(size(10))
    await vi.advanceTimersByTimeAsync(16)
    expect(test.publish).toHaveBeenLastCalledWith({ a: size(10) })
    test.controller.setVisible(['b'])
    test.controller.setVisible(['a'])
    expect(test.requests.map(({ path }) => path)).toEqual(['a', 'b'])
    expect(test.api.cancelFolderSize).toHaveBeenCalledWith(test.requests[1].id)
    expect(test.api.folderSizesCached).toHaveBeenCalledTimes(2)
    test.controller.dispose()
  })

  it('ignores a cancelled request after the same row re-enters the viewport', async () => {
    const test = fixture(['a'])
    test.controller.setVisible(['a'])
    const old = test.requests[0]
    test.controller.setVisible([])
    test.controller.setVisible(['a'])
    const current = test.requests[1]
    test.progress(old.id, 99)
    old.resolve(size(99))
    test.progress(current.id, 5)
    current.resolve(size(6))
    await vi.advanceTimersByTimeAsync(16)
    expect(test.publish).toHaveBeenCalledExactlyOnceWith({ a: size(6) })
    test.controller.dispose()
  })

  it('batches progress and completions into one update per frame interval', async () => {
    const test = fixture(['a', 'b'])
    test.controller.setVisible(['a', 'b'])
    for (let bytes = 0; bytes < 100; bytes++) test.progress(test.requests[0].id, bytes)
    test.requests[0].resolve(size(100))
    test.requests[1].resolve(size(200))
    expect(test.publish).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(16)
    expect(test.publish).toHaveBeenCalledExactlyOnceWith({ a: size(100), b: size(200) })
    test.controller.dispose()
  })

  it('hydrates visible cached values without overwriting newer completed results', async () => {
    const test = fixture(['a', 'b'])
    let hydrate!: (value: Record<string, FolderSizeResult>) => void
    test.api.folderSizesCached.mockImplementation(
      () =>
        new Promise((resolve) => {
          hydrate = resolve
        })
    )
    test.controller.setVisible(['a', 'b'])
    test.requests[0].resolve(size(40))
    await vi.advanceTimersByTimeAsync(0)
    hydrate({ a: size(1), b: size(2) })
    await vi.advanceTimersByTimeAsync(16)
    expect(test.publish).toHaveBeenCalledExactlyOnceWith({ a: size(40), b: size(2) })
    test.controller.dispose()
  })

  it('clears scheduled updates and cancels requests when disposed', async () => {
    const test = fixture(['a'])
    test.controller.setVisible(['a'])
    test.progress(test.requests[0].id, 5)
    test.controller.dispose()
    test.requests[0].resolve(size(6))
    await vi.advanceTimersByTimeAsync(16)
    expect(test.publish).not.toHaveBeenCalled()
    expect(test.api.cancelFolderSize).toHaveBeenCalledExactlyOnceWith(test.requests[0].id)
    expect(test.unsubscribe).toHaveBeenCalledOnce()
  })
})
