import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { newBrowse } from './browse'
import { newTab, type Tab } from './tabs'
import { useFolderBrowsing } from './useFolderBrowsing'

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
