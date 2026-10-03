import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { browseLocation, newBrowse } from './browse'
import { newTab, type Tab } from './tabs'
import { arrivalSelection, useFolderBrowsing } from './useFolderBrowsing'

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

function restored(role?: Tab['role']): Tab {
  const browse = newBrowse('C:\\project', 'folder')
  browse.history[0].query = 'notes'
  return {
    ...newTab({ root: browse.path, files: [], index: -1, browse, role }, 'restored'),
    role
  }
}

describe('project and Explorer surface isolation', () => {
  it.each(['project', undefined] as const)('keeps a restored %s project out of folder search and loading', (role) => {
    const result = initialBrowsing(restored(role))
    expect(result.folder).toBe(false)
    expect(result.searchState).toBeUndefined()
    expect(result.loading).toBe(false)
  })

  it('retains folder browsing and the saved search for Explorer', () => {
    const result = initialBrowsing(restored('explorer'))
    expect(result.folder).toBe(true)
    expect(result.searchState?.running).toBe(true)
    expect(result.loading).toBe(true)
  })

  it('keeps a project with a hidden terminal out of the folder surface', () => {
    const tab = restored('project')
    tab.term = { id: 'shell', view: 'hidden' }
    tab.terms = ['shell']
    const result = initialBrowsing(tab)
    expect(result.folder).toBe(false)
    expect(result.searchState).toBeUndefined()
    expect(tab.term).toEqual({ id: 'shell', view: 'hidden' })
  })

  it('keeps the Explorer split file when the list navigates or selects a folder', () => {
    const tab = restored('explorer')
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
    const tab = restored('explorer')
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
    const tab = restored('explorer')
    const tabs = arrivalSelection([tab], tab.id, 'C:\\project\\v1.mp4', false)
    expect(browseLocation(tabs[0].browse).selected).toBe('C:\\project\\v1.mp4')
  })

  it('leaves the marks their selected path when rows were marked meanwhile', () => {
    const tab = restored('explorer')
    tab.browse.history[0].selected = 'C:\\project\\v3.mp4'
    const tabs = arrivalSelection([tab], tab.id, 'C:\\project\\v1.mp4', true)
    expect(browseLocation(tabs[0].browse).selected).toBe('C:\\project\\v3.mp4')
  })
})
