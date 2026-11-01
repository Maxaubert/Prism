import { createElement, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { browseLocation, newBrowse } from '../lib/browse'
import { newTab, type Tab } from '../lib/tabs/tabs'
import {
  arrivalSelection,
  BACKGROUND_READ_SLOW_MS,
  FOCUS_TRUST_MS,
  focusNeedsRead,
  openFolderCrumb,
  selectionMoved,
  useFolderBrowsing
} from './useFolderBrowsing'
import { crumb } from 'prism-term-core/renderer/lib/diag'

// The diagnostics log's crumbs (#322), caught rather than sent.
vi.mock('prism-term-core/renderer/lib/diag', () => ({ crumb: vi.fn() }))

// Render the hook's initial state without starting filesystem effects. This
// covers restored folder/search state before any IPC response can change it.
function initialBrowsing(tab: Tab): ReturnType<typeof useFolderBrowsing> {
  let result!: ReturnType<typeof useFolderBrowsing>
  function Probe(): null {
    result = useFolderBrowsing(tab, () => {}, 0)
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return result
}

function restored(): Tab {
  const browse = newBrowse('C:\\project', 'folder')
  browse.history[0].query = 'notes'
  return newTab({ root: browse.path, files: [], index: -1, browse }, 'restored')
}

describe('one browsing object while nothing changed (perf review, 2026-10-28)', () => {
  it('hands back the same object on a render where nothing it holds changed', () => {
    const tab = restored()
    const seen: ReturnType<typeof useFolderBrowsing>[] = []
    const noop = (): void => {}
    function Probe(): null {
      const [n, setN] = useState(0)
      seen.push(useFolderBrowsing(tab, noop, 0))
      // A render-phase update: the component renders again, hooks kept.
      if (n === 0) setN(1)
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBe(seen[0])
    expect(seen[1].cancelSearch).toBe(seen[0].cancelSearch)
    expect(seen[1].searchState).toBe(seen[0].searchState)
  })
})

describe('Explorer surface', () => {
  it('retains folder browsing and the saved search for Explorer', () => {
    const result = initialBrowsing(restored())
    expect(result.folder).toBe(true)
    expect(result.searchState?.running).toBe(true)
    // Waiting for its folder, quietly: no hint before 300 ms, never a message.
    expect(result.pending).toBe('quiet')
  })

  it('keeps the Explorer split file when the list navigates or selects a folder', () => {
    const tab = restored()
    const file = {
      path: 'C:\\movies\\clip.mp4',
      name: 'clip.mp4',
      ext: '.mp4',
      kind: 'video' as const,
      size: 100,
      mtimeMs: 0
    }
    tab.files = [file]
    tab.index = 0
    tab.browse.preview = true
    tab.browse.history[0].selected = 'C:\\project\\Nested'
    const result = initialBrowsing(tab)
    expect(result.folder).toBe(true)
    expect(result.previewFile).toBe(file)
    expect(result.location?.selected).toBe('C:\\project\\Nested')
  })
})

describe('a quiet select (#263)', () => {
  // A sweep or a Ctrl or Shift click marks rows: it moves the selected path
  // and leaves the preview and its player alone. A plain pick still pauses
  // what played (the folder rule) or previews the file.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function probe(): {
    select: ReturnType<typeof useFolderBrowsing>['select']
    updates: () => number
    looks: () => number
  } {
    const tab = restored()
    tab.browse.preview = true
    let updates = 0
    const setState = (() => {
      updates++
    }) as Parameters<typeof useFolderBrowsing>[1]
    let result!: ReturnType<typeof useFolderBrowsing>
    function Probe(): null {
      result = useFolderBrowsing(tab, setState, 0)
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    // The players are found through the document; a look is a pause.
    const doc = document as unknown as { querySelectorAll?: () => never[] }
    doc.querySelectorAll ??= () => []
    const looks = vi.spyOn(doc as { querySelectorAll: () => never[] }, 'querySelectorAll')
    return { select: result.select, updates: () => updates, looks: () => looks.mock.calls.length }
  }

  it('patches the selected path and touches no player', () => {
    const p = probe()
    p.select('C:\\project\\clip.mp4', true)
    expect(p.updates()).toBe(1)
    expect(p.looks()).toBe(0)
  })

  it('leaves a plain select as it was', () => {
    const p = probe()
    p.select('C:\\project\\Nested')
    expect(p.updates()).toBe(1)
    expect(p.looks()).toBe(1)
  })
})

describe('an open that lands after a sweep (#263)', () => {
  it('takes the selected path when nothing was marked meanwhile', () => {
    const tab = restored()
    const tabs = arrivalSelection([tab], tab.id, 'C:\\project\\v1.mp4', false)
    expect(browseLocation(tabs[0].browse).selected).toBe('C:\\project\\v1.mp4')
  })

  it('leaves the marks their selected path when rows were marked meanwhile', () => {
    const tab = restored()
    tab.browse.history[0].selected = 'C:\\project\\v3.mp4'
    const tabs = arrivalSelection([tab], tab.id, 'C:\\project\\v1.mp4', true)
    expect(browseLocation(tabs[0].browse).selected).toBe('C:\\project\\v3.mp4')
  })
})

describe('the way out of a zip loses to a landing mark (#70, #101, #334)', () => {
  // Out of a zip, the zip is marked and its preview comes back. A drag that
  // extracted a member to the folder marks what landed. When both are judged
  // in the same commit, the list's landing mark runs first (a child's effect)
  // and the way-out open is asked after it: its count of marks then saw no
  // change, and its landing took the selection back to the zip (the drag
  // e2e, 1 in 38). The open judged on the zip being marked: once the tab
  // marks something else, it is not the way out any more.
  const zip = 'C:\\project\\dragzip.zip'
  const carried = 'C:\\project\\carry.txt'

  it('a mark that moved off the zip keeps its row', () => {
    const tab = restored()
    tab.browse.history[0].selected = carried
    expect(selectionMoved([tab], tab.id, zip)).toBe(true)
    const tabs = arrivalSelection([tab], tab.id, zip, selectionMoved([tab], tab.id, zip))
    expect(browseLocation(tabs[0].browse).selected).toBe(carried)
  })

  it('still on the zip, the open takes it as before', () => {
    const tab = restored()
    tab.browse.history[0].selected = 'c:\\PROJECT\\dragzip.zip'
    expect(selectionMoved([tab], tab.id, zip)).toBe(false)
    expect(browseLocation(arrivalSelection([tab], tab.id, zip, false)[0].browse).selected).toBe(zip)
  })

  it('a tab that is gone moved nothing', () => {
    expect(selectionMoved([], 'nobody', zip)).toBe(false)
  })
})

describe('the focus trusts a live watch (perf review #10)', () => {
  const key = 'c:\\dl'
  it('reads nothing while the watch is up and the rows are recent', () => {
    expect(focusNeedsRead({ tabId: 't', key }, { tabId: 't', key, at: 1000 }, 't', key, 2000)).toBe(false)
  })
  it('reads when no watch is up, it is another folder, or the read is old', () => {
    expect(focusNeedsRead(null, { tabId: 't', key, at: 1000 }, 't', key, 2000)).toBe(true)
    expect(focusNeedsRead({ tabId: 't', key: 'c:\\other' }, { tabId: 't', key, at: 1000 }, 't', key, 2000)).toBe(true)
    expect(focusNeedsRead({ tabId: 'u', key }, { tabId: 't', key, at: 1000 }, 't', key, 2000)).toBe(true)
    expect(focusNeedsRead({ tabId: 't', key }, { tabId: 't', key, at: 1000 }, 't', key, 1000 + FOCUS_TRUST_MS)).toBe(true)
    expect(focusNeedsRead({ tabId: 't', key }, null, 't', key, 2000)).toBe(true)
  })
})

describe('the open-folder crumb (#322)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(crumb).mockClear()
  })

  it('says where a navigation went, why, how long, how many rows, and whether rows were cached', async () => {
    const listing = {
      folders: [{ path: 'C:\\data\\a', name: 'a' }],
      files: [{ path: 'C:\\data\\b.txt', name: 'b.txt' }, { path: 'C:\\data\\c.txt', name: 'c.txt' }]
    }
    vi.stubGlobal('window', {
      prism: { browseDirectory: async (_tab: string, path: string) => ({ path, listing }) }
    })
    const tab = restored()
    let result!: ReturnType<typeof useFolderBrowsing>
    function Probe(): null {
      result = useFolderBrowsing(tab, () => {}, 0)
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    const doc = document as unknown as { querySelectorAll?: () => never[] }
    doc.querySelectorAll ??= () => []
    await result.navigate('C:\\data')
    expect(vi.mocked(crumb).mock.calls).toEqual([
      [
        'open-folder',
        { path: 'C:\\data', reason: 'navigate', ms: expect.any(Number), entries: 3, cached: false },
        { often: false }
      ]
    ])
  })

  it('marks a folder that could not be read', async () => {
    vi.stubGlobal('window', { prism: { browseDirectory: async () => null } })
    const tab = restored()
    let result!: ReturnType<typeof useFolderBrowsing>
    function Probe(): null {
      result = useFolderBrowsing(tab, () => {}, 0)
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    const doc = document as unknown as { querySelectorAll?: () => never[] }
    doc.querySelectorAll ??= () => []
    await result.navigate('C:\\gone')
    expect(vi.mocked(crumb).mock.calls[0][1]).toMatchObject({ path: 'C:\\gone', entries: null, unreadable: true })
  })

  it('keeps a quick background re-read for Detailed logging, and says a slow one quietly', () => {
    const listing = { folders: [], files: [] }
    const now = performance.now()
    openFolderCrumb('C:\\dl', 'dir-changed', now, listing, true)
    openFolderCrumb('C:\\dl', 'focus', now, listing, true)
    openFolderCrumb('C:\\dl', 'dir-changed', now - BACKGROUND_READ_SLOW_MS - 50, listing, true)
    openFolderCrumb('C:\\dl', 'refresh', now, listing, true)
    expect(vi.mocked(crumb).mock.calls.map((c) => [c[1]?.reason, c[2]])).toEqual([
      ['dir-changed', { often: true }],
      ['focus', { often: true }],
      ['dir-changed', { often: false }],
      ['refresh', { often: false }]
    ])
  })
})
