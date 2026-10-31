import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pathKey } from '@shared/path'

/**
 * The folder icon store and main's kept pictures, wired as the app loads them
 * (review T3): the start-up step that drops an entry whose copy is gone, and
 * the prune a reset or a replace asks main for. Each test loads the modules
 * fresh, so the store's own registration is what runs.
 */

const KEY = 'prism.folderIcons'
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

let onDisk: Record<string, string> = {}
let complete = true
const folderIconFiles = vi.fn(async () => ({ files: { ...onDisk }, complete }))
const pruneFolderIcons = vi.fn<(keep: string[]) => Promise<number>>(async () => 0)
const holder = globalThis as unknown as { window?: { prism?: unknown } }
let hadWindow = false

const load = async (): Promise<typeof import('./folderIcons')> => {
  vi.resetModules()
  return import('./folderIcons')
}
const stored = (): string[] => Object.keys(JSON.parse(localStorage.getItem(KEY) ?? '{}')).map(pathKey).sort()
const keys = (...paths: string[]): string[] => paths.map(pathKey).sort()

beforeEach(() => {
  onDisk = { [A]: 'data:a' }
  complete = true
  folderIconFiles.mockClear()
  pruneFolderIcons.mockClear()
  hadWindow = !!holder.window
  holder.window ??= {} as never
  holder.window!.prism = { folderIconFiles, pruneFolderIcons }
  localStorage.setItem(KEY, JSON.stringify({ 'C:/Art': { file: A }, 'C:/Gone': { file: B }, 'C:/Cam': { set: 'camera' } }))
})
afterEach(() => {
  localStorage.removeItem(KEY)
  delete holder.window!.prism
  if (!hadWindow) delete holder.window
})

describe('folder icons and the kept pictures', () => {
  it('the first complete list drops the entry whose copy is gone, and only that', async () => {
    const { useFolderIcons } = await load()
    const { preloadFolderIconFiles } = await import('./folderIconFiles')
    expect(typeof useFolderIcons).toBe('function')
    preloadFolderIconFiles()
    await flush()
    expect(stored()).toEqual(keys('C:/Art', 'C:/Cam'))
  })

  it('a list main could not read in full drops nothing (review M1)', async () => {
    await load()
    const { preloadFolderIconFiles } = await import('./folderIconFiles')
    complete = false
    onDisk = {} // every copy held by a scan
    preloadFolderIconFiles()
    await flush()
    expect(stored()).toEqual(keys('C:/Art', 'C:/Cam', 'C:/Gone'))
    // Nor does a later set prune them: the entries still name them.
    const { setFolderIcons } = await load()
    setFolderIcons(['C:/New'], { set: 'star' })
    expect(pruneFolderIcons).not.toHaveBeenCalled()
  })

  it('a reset that drops a picture asks main to prune, keeping the ones still named', async () => {
    const { setFolderIcons } = await load()
    setFolderIcons(['C:/Cam'], null)
    expect(pruneFolderIcons).not.toHaveBeenCalled() // no picture dropped
    setFolderIcons(['C:/Gone'], null)
    expect(pruneFolderIcons).toHaveBeenCalledWith([A])
  })

  it('a move that replaces a folder with a picture prunes too (review L3)', async () => {
    const { followFolderIcons } = await load()
    // C:/Cam moves onto C:/Gone: the replaced folder's picture B goes.
    followFolderIcons([{ from: 'C:/Cam', to: 'C:/Gone' }])
    expect(pruneFolderIcons).toHaveBeenCalledWith([A])
    // A move that drops no picture asks nothing.
    pruneFolderIcons.mockClear()
    followFolderIcons([{ from: 'C:/Art', to: 'C:/Art2' }])
    expect(pruneFolderIcons).not.toHaveBeenCalled()
  })
})
