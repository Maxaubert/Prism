import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newBrowse } from '../lib/browse'
import { newTab } from '../lib/tabs/tabs'
import { movedOn } from '../lib/fileOpsFollow'
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
function ops(openBrowseFile: FileOpsDeps['openBrowseFile']): ReturnType<typeof useFileOps> {
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
    archiveActions: { drop: noop }
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
