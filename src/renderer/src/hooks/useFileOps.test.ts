import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newBrowse } from '../lib/browse'
import { newTab } from '../lib/tabs/tabs'
import { movedOn } from '../lib/fileOpsFollow'
import { readFolderIcons, setFolderIcons } from '../lib/folderIcons'
import { pathKey } from '@shared/path'
import { useFileOps, type FileOpsDeps } from './useFileOps'
import type { ViewerFile } from '@shared/types'

const film: ViewerFile = {
  path: 'C:\\films\\clip.mp4',
  name: 'clip.mp4',
  ext: '.mp4',
  kind: 'video',
  size: 100,
  mtimeMs: 0
}

// One render of the hook, effects not run: what the file operations do with
// the state they were started from.
function ops(
  openBrowseFile: FileOpsDeps['openBrowseFile'],
  extra: Partial<FileOpsDeps> = {}
): ReturnType<typeof useFileOps> {
  const browse = newBrowse('C:\\films', 'viewer')
  const active = newTab(
    { root: 'C:\\films', files: [film], index: 0, browse, role: 'explorer' },
    'explorer'
  )
  const noop = (): void => {}
  const deps = {
    active,
    openBrowseFile,
    open: noop,
    setAsk: noop,
    setRefreshKey: noop,
    rekeyBuffer: noop,
    setUndoState: noop,
    file: film,
    noteUndo: noop,
    setTabState: noop,
    dropBuffers: noop,
    view: { files: [film], index: 0 },
    showNothing: noop,
    tabs: [active],
    buffers: { current: new Map() },
    undoState: { done: [], undone: [] },
    flashUndo: noop,
    archiveActions: { drop: noop },
    ...extra
  } as unknown as FileOpsDeps
  let result!: ReturnType<typeof useFileOps>
  function Probe(): null {
    result = useFileOps(deps)
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return result
}

afterEach(() => vi.unstubAllGlobals())

describe('a folder rename carries the unsaved text inside it (audit 2026-11-18, #533)', () => {
  it('rekeys a dirty file under the renamed folder, and leaves a sibling folder alone', async () => {
    vi.stubGlobal('window', {
      prism: { renameFile: async () => ({ ok: true, path: 'C:\\films\\D2' }), mediaUrl: (p: string) => p }
    })
    const buffers = {
      current: new Map([
        ['c:\\films\\d\\a.txt', { path: 'C:\\films\\D\\a.txt', text: 'x' }],
        ['c:\\films\\d\\sub\\b.txt', { path: 'C:\\films\\D\\sub\\b.txt', text: 'y' }],
        ['c:\\films\\dx\\c.txt', { path: 'C:\\films\\Dx\\c.txt', text: 'z' }]
      ])
    }
    const rekeyBuffer = vi.fn()
    await ops(vi.fn(async () => true), { buffers, rekeyBuffer } as unknown as Partial<FileOpsDeps>).runRename(
      'C:\\films\\D',
      'D2',
      'ask'
    )
    expect(rekeyBuffer.mock.calls).toEqual([
      ['C:\\films\\D\\a.txt', 'C:\\films\\D2\\a.txt'],
      ['C:\\films\\D\\sub\\b.txt', 'C:\\films\\D2\\sub\\b.txt']
    ])
  })
})

describe('a rename or delete elsewhere does not start the film on screen (2026-10-16)', () => {
  it('re-shows the paused film without the intent to play after renaming another file', async () => {
    vi.stubGlobal('window', {
      prism: {
        renameFile: async () => ({ ok: true, path: 'C:\\films\\b2.txt' }),
        mediaUrl: (p: string) => 'fsmedia://' + p
      }
    })
    const open = vi.fn(async () => true)
    await ops(open).runRename('C:\\films\\b.txt', 'b2.txt', 'ask')
    expect(open).toHaveBeenCalledWith(film.path, true, false)
  })

  it('re-shows it without the intent to play after binning another file', async () => {
    vi.stubGlobal('window', {
      prism: { trashFile: async () => true, mediaUrl: (p: string) => 'fsmedia://' + p }
    })
    const open = vi.fn(async () => true)
    await ops(open).runDelete('C:\\films\\b.txt')
    expect(open).toHaveBeenCalledWith(film.path, true, false)
  })
})

describe('movedOn (2026-10-16)', () => {
  it('is false while the same file is on screen, or none (a delete steps off it)', () => {
    expect(movedOn('C:\\a.txt', 'C:\\a.txt')).toBe(false)
    expect(movedOn('C:\\a.txt', undefined)).toBe(false)
  })

  it('is true once another file is on screen', () => {
    expect(movedOn('C:\\a.txt', 'C:\\b.txt')).toBe(true)
    expect(movedOn(undefined, 'C:\\b.txt')).toBe(true)
  })
})

describe('folder icons follow a rename done in Prism (2026-10-31, D9)', () => {
  const keys = (): string[] => [...readFolderIcons().keys()].sort()
  const k = (...paths: string[]): string[] => paths.map(pathKey).sort()

  it('the renamed folder and every folder under it keep their icons; undo renames back the same way', async () => {
    setFolderIcons(['C:/films/trips', 'C:/films/trips/2024'], { set: 'camera' })
    let to = 'C:/films/travel'
    vi.stubGlobal('window', {
      prism: {
        renameFile: async () => ({ ok: true, path: to }),
        mediaUrl: (p: string) => 'fsmedia://' + p
      }
    })
    const o = ops(vi.fn(async () => true))
    await o.runRename('C:/films/trips', 'travel', 'ask')
    expect(keys()).toEqual(k('C:/films/travel', 'C:/films/travel/2024'))
    // An undo is a rename back through the same call (undoApply's ops.rename).
    to = 'C:/films/trips'
    await o.runRename('C:/films/travel', 'trips', 'keep-both', false)
    expect(keys()).toEqual(k('C:/films/trips', 'C:/films/trips/2024'))
    setFolderIcons(['C:/films/trips', 'C:/films/trips/2024'], null)
  })

  it('a failed rename leaves the icons where they are', async () => {
    setFolderIcons(['C:/films/trips'], { set: 'camera' })
    vi.stubGlobal('window', {
      prism: { renameFile: async () => ({ ok: false, reason: 'failed' }), mediaUrl: (p: string) => p }
    })
    await ops(vi.fn(async () => true)).runRename('C:/films/trips', 'travel', 'ask')
    expect(keys()).toEqual(k('C:/films/trips'))
    setFolderIcons(['C:/films/trips'], null)
  })
})

describe('a delete of a playing film waits for the player to let go (audit #76)', () => {
  afterEach(() => vi.useRealTimers())

  it('holds the bin back a beat when a tab shows the file, and not when none does', async () => {
    vi.useFakeTimers()
    const trashFile = vi.fn(async () => true)
    vi.stubGlobal('window', { prism: { trashFile, mediaUrl: (p: string) => p } })
    const o = ops(vi.fn(async () => true))
    const done = o.runDelete('C:\\films\\clip.mp4')
    await vi.advanceTimersByTimeAsync(100)
    expect(trashFile).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(trashFile).toHaveBeenCalledTimes(1)
    await done

    trashFile.mockClear()
    const other = o.runDelete('C:\\films\\other.mp4')
    await vi.advanceTimersByTimeAsync(100)
    expect(trashFile).toHaveBeenCalledTimes(1)
    await other
  })
})