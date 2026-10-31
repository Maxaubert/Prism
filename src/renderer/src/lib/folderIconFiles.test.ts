import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  folderIconFilesNow,
  keptFolderIconFile,
  onFirstFolderIconFiles,
  preloadFolderIconFiles,
  resetFolderIconFilesForTest,
  wantFolderIconFile
} from './folderIconFiles'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

let onDisk: Record<string, string> = {}
const folderIconFiles = vi.fn(async () => ({ ...onDisk }))
const holder = globalThis as unknown as { window?: { prism?: unknown } }
let hadWindow = false

beforeEach(() => {
  resetFolderIconFilesForTest()
  onDisk = { [A]: 'data:a' }
  folderIconFiles.mockClear()
  hadWindow = !!holder.window
  holder.window ??= {} as never
  holder.window!.prism = { folderIconFiles }
})
afterEach(() => {
  delete holder.window!.prism
  if (!hadWindow) delete holder.window
})

describe('the kept icon pictures', () => {
  it('nothing is asked for until a folder has one, then once', async () => {
    expect(folderIconFilesNow()).toBeNull()
    preloadFolderIconFiles()
    preloadFolderIconFiles()
    await flush()
    expect(folderIconFiles).toHaveBeenCalledTimes(1)
    expect(folderIconFilesNow()?.get(A)).toBe('data:a')
    preloadFolderIconFiles()
    expect(folderIconFiles).toHaveBeenCalledTimes(1)
  })

  it('tells the store which copies main has, the first time only', async () => {
    const first = vi.fn()
    onFirstFolderIconFiles(first)
    preloadFolderIconFiles()
    await flush()
    expect(first).toHaveBeenCalledTimes(1)
    expect([...first.mock.calls[0][0].keys()]).toEqual([A])
    const late = vi.fn()
    onFirstFolderIconFiles(late)
    expect(late).not.toHaveBeenCalled()
  })

  it('a picture another window kept is asked for once more, not on every row', async () => {
    preloadFolderIconFiles()
    await flush()
    onDisk[B] = 'data:b'
    wantFolderIconFile(B)
    wantFolderIconFile(B)
    await flush()
    expect(folderIconFiles).toHaveBeenCalledTimes(2)
    expect(folderIconFilesNow()?.get(B)).toBe('data:b')
    wantFolderIconFile(B)
    wantFolderIconFile(C)
    await flush()
    wantFolderIconFile(C)
    await flush()
    expect(folderIconFiles).toHaveBeenCalledTimes(3)
  })

  it("this window's own pick draws at once, and the first load still reports", async () => {
    keptFolderIconFile(B, 'data:b')
    expect(folderIconFilesNow()?.get(B)).toBe('data:b')
    const first = vi.fn()
    onFirstFolderIconFiles(first)
    preloadFolderIconFiles()
    await flush()
    expect(first).toHaveBeenCalledTimes(1)
    expect(folderIconFilesNow()?.get(A)).toBe('data:a')
    expect(folderIconFilesNow()?.get(B)).toBe('data:b')
  })
})
