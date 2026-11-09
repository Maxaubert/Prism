import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newBrowse } from '../lib/browse'
import { newTab } from '../lib/tabs/tabs'
import { listJobs, resetJobs } from '../lib/jobs'
import { resetHolds } from '../lib/holds'
import { useFileOps, type FileOpsDeps } from './useFileOps'

// One render, effects not run: a move's `finally` waits for a commit that never
// comes here, so these look at what the move did, and never await its end.
function mover(noteUndo: FileOpsDeps['noteUndo']): ReturnType<typeof useFileOps> {
  const browse = newBrowse('C:\\a', 'folder')
  const active = newTab({ root: 'C:\\a', files: [], index: -1, browse, role: 'explorer' }, 'explorer')
  const noop = (): void => {}
  const deps = {
    active,
    openBrowseFile: noop,
    setAsk: noop,
    setRefreshKey: noop,
    rekeyBuffer: noop,
    setUndoState: noop,
    file: null,
    noteUndo,
    setTabState: noop,
    dropBuffers: noop,
    view: null,
    showNothing: noop,
    tabs: [active],
    buffers: { current: new Map() },
    undoState: { past: [], future: [] },
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

const answer = { moved: [], clashes: [], failed: [], replaced: [], busy: [] }

afterEach(() => {
  vi.unstubAllGlobals()
  resetHolds()
  resetJobs()
})

describe('Cancel on a move (the loading bar, review 2026-11-09)', () => {
  it('a replaced file already in the bin stays undoable when Cancel stopped its mover', async () => {
    const noteUndo = vi.fn()
    vi.stubGlobal('window', {
      prism: {
        moveEntries: vi.fn(async () => ({ ...answer, replaced: ['C:\\b\\x.bin'], cancelled: true })),
        cancelFileJob: vi.fn(async () => true)
      }
    })
    void mover(noteUndo).runMove(['C:\\a\\x.bin'], 'C:\\b', 'replace')
    await vi.waitFor(() => expect(noteUndo).toHaveBeenCalledWith({ kind: 'trash', paths: ['C:\\b\\x.bin'] }), {
      timeout: 500
    })
  })

  it('a move stopped with nothing replaced leaves nothing on the stack', async () => {
    const noteUndo = vi.fn()
    const moveEntries = vi.fn(async () => ({ ...answer, cancelled: true }))
    vi.stubGlobal('window', { prism: { moveEntries, cancelFileJob: vi.fn(async () => true) } })
    void mover(noteUndo).runMove(['C:\\a\\x.bin'], 'C:\\b', 'replace')
    await vi.waitFor(() => expect(moveEntries).toHaveBeenCalledTimes(1), { timeout: 500 })
    await new Promise((r) => setTimeout(r, 30))
    expect(noteUndo).not.toHaveBeenCalled()
  })

  it('Cancel during the wait for a busy file starts no second try', async () => {
    const moveEntries = vi.fn(async () => ({ ...answer, failed: ['C:\\a\\x.bin'], busy: ['C:\\a\\x.bin'] }))
    vi.stubGlobal('window', { prism: { moveEntries, cancelFileJob: vi.fn(async () => true) } })
    void mover(vi.fn()).runMove(['C:\\a\\x.bin'], 'C:\\b', 'keep-both')
    await vi.waitFor(() => expect(moveEntries).toHaveBeenCalledTimes(1), { timeout: 500 })
    listJobs().at(-1)?.cancel?.()
    await new Promise((r) => setTimeout(r, 450))
    expect(moveEntries).toHaveBeenCalledTimes(1)
  })
})
