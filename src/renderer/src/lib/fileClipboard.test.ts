import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const copy = vi.fn<(paths: string[], cut?: boolean) => Promise<boolean>>()

beforeEach(() => {
  vi.resetModules()
  copy.mockReset().mockResolvedValue(true)
  vi.stubGlobal('window', { prism: { copyFilesToClipboard: copy } })
})
afterEach(() => vi.unstubAllGlobals())

describe('file clipboard across Explorer and project tabs', () => {
  it('waits for queued copies before exposing the final cut mark to paste', async () => {
    const releases: Array<(copied: boolean) => void> = []
    copy.mockImplementation(() => new Promise((resolve) => releases.push(resolve)))
    const clipboard = await import('./fileClipboard')
    const first = clipboard.copyFilePaths(['C:\\first.txt'], true)
    const second = clipboard.copyFilePaths(['C:\\second.txt'], true)
    let ready = false
    void clipboard.fileClipboardReady().then(() => {
      ready = true
    })
    await vi.waitFor(() => expect(copy).toHaveBeenCalledTimes(1))
    expect(ready).toBe(false)
    expect(clipboard.fileCutPaths()).toEqual([])
    releases[0](true)
    await first
    await vi.waitFor(() => expect(copy).toHaveBeenCalledTimes(2))
    expect(ready).toBe(false)
    releases[1](true)
    await second
    await clipboard.fileClipboardReady()
    expect(ready).toBe(true)
    expect(clipboard.fileCutPaths()).toEqual(['C:\\second.txt'])
  })

  it('does not cancel a newer cut when an earlier move completes', async () => {
    const clipboard = await import('./fileClipboard')
    await clipboard.copyFilePaths(['C:\\first.txt'], true)
    let release!: (copied: boolean) => void
    copy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const next = clipboard.copyFilePaths(['C:\\second.txt'], true)
    await vi.waitFor(() => expect(copy).toHaveBeenCalledTimes(2))
    clipboard.clearFileCut(['C:\\first.txt'])
    release(true)
    await next
    expect(clipboard.fileCutPaths()).toEqual(['C:\\second.txt'])
  })

  it('Copy cancels Cut even when it copies the same file', async () => {
    const clipboard = await import('./fileClipboard')
    await clipboard.copyFilePaths(['C:\\comic.cbz'], true)
    expect(copy).toHaveBeenLastCalledWith(['C:\\comic.cbz'], true)
    await clipboard.copyFilePaths(['C:\\comic.cbz'])
    expect(copy).toHaveBeenLastCalledWith(['C:\\comic.cbz'], false)
    expect(clipboard.fileCutPaths()).toEqual([])
  })

  it('keeps the current cut after a failed copy or an unrelated paste completion', async () => {
    const clipboard = await import('./fileClipboard')
    await clipboard.copyFilePaths(['C:\\first.txt'], true)
    copy.mockResolvedValueOnce(false)
    expect(await clipboard.copyFilePaths(['C:\\missing.txt'])).toBe(false)
    clipboard.clearFileCut(['C:\\other.txt'])
    expect(clipboard.fileCutPaths()).toEqual(['C:\\first.txt'])
  })
})
