import { describe, expect, it } from 'vitest'
import {
  browseCrumbs,
  browseLocation,
  browseParent,
  navigateBrowseState,
  newBrowse,
  travelBrowseState,
  updateBrowseLocation
} from './browse'
import {
  addTab,
  navigateBrowse,
  newTab,
  receiveFile,
  setBrowseLocation,
  setBrowsePreview,
  setBrowseSurface,
  setTabTerm,
  tabLabels,
  travelBrowse
} from './tabs'
import type { OpenPayload, ViewerFile } from '@shared/types'

const root = 'C:\\Projects\\Prism'
const other = 'X:\\Movies'
const file: ViewerFile = {
  path: `${root}\\notes.txt`,
  name: 'notes.txt',
  ext: '.txt',
  kind: 'text',
  size: 20,
  mtimeMs: 0
}
const payload: OpenPayload = { root, files: [file], index: 0 }

describe('folder history', () => {
  it('returns to the selected row, search, sorting and scroll position', () => {
    let state = updateBrowseLocation(newBrowse(root), {
      selected: file.path,
      query: 'notes',
      scrollTop: 640,
      sort: { key: 'modified', direction: 'desc' }
    })
    const left = browseLocation(state)
    state = navigateBrowseState(state, other)
    expect(browseLocation(state).sort).toEqual(left.sort)
    expect(browseLocation(state).query).toBe('')
    state = updateBrowseLocation(state, { selected: `${other}\\film.mkv`, scrollTop: 240 })
    const right = browseLocation(state)
    state = travelBrowseState(state, -1)
    expect(state.path).toBe(root)
    expect(browseLocation(state)).toEqual(left)
    state = travelBrowseState(state, 1)
    expect(state.path).toBe(other)
    expect(browseLocation(state)).toEqual(right)
  })

  it('branches history after going back and remembers a breadcrumb revisit', () => {
    let state = updateBrowseLocation(newBrowse(root), { scrollTop: 720 })
    state = navigateBrowseState(state, other)
    state = navigateBrowseState(state, 'C:\\Users\\Admin')
    state = travelBrowseState(state, -1)
    state = navigateBrowseState(state, root)
    expect(state.history.map((entry) => entry.path)).toEqual([root, other, root])
    expect(browseLocation(state).scrollTop).toBe(720)
    expect(travelBrowseState(state, 1)).toBe(state)
  })

  it('does not add a duplicate entry for equivalent Windows folder paths', () => {
    const state = newBrowse(root, 'viewer')
    const next = navigateBrowseState(state, 'c:/projects/PRISM/')
    expect(next.history).toBe(state.history)
    expect(next.surface).toBe('folder')
  })

  it('bounds the saved history without losing the current position', () => {
    let state = newBrowse(root)
    for (let i = 0; i < 110; i++) state = navigateBrowseState(state, `C:\\folder${i}`)
    expect(state.history).toHaveLength(100)
    expect(browseLocation(state).path).toBe('C:\\folder109')
    expect(state.cursor).toBe(99)
  })

  it('walks drive and network-share ancestors without an invalid parent', () => {
    expect(browseParent('C:\\')).toBeNull()
    expect(browseParent('C:\\Users')).toBe('C:\\')
    expect(browseParent('C:/Users/Admin/')).toBe('C:\\Users')
    expect(browseParent('\\\\server\\share\\')).toBeNull()
    expect(browseParent('\\\\server\\share\\folder')).toBe('\\\\server\\share')
    expect(browseCrumbs('C:\\Users\\Admin')).toEqual([
      { name: 'C:\\', path: 'C:\\' },
      { name: 'Users', path: 'C:\\Users' },
      { name: 'Admin', path: 'C:\\Users\\Admin' }
    ])
    expect(browseCrumbs('\\\\server\\share\\folder')).toEqual([
      { name: '\\\\server\\share', path: '\\\\server\\share' },
      { name: 'folder', path: '\\\\server\\share\\folder' }
    ])
  })
})

describe('browsing alongside sessions', () => {
  it('leaves shells, project identity, viewers, trees and pinned panes intact', () => {
    const initial = setTabTerm([newTab(payload, 'project')], 'project', {
      id: 'agent',
      view: 'full'
    })
    const tab = initial[0]
    let tabs = navigateBrowse(initial, tab.id, other)
    expect(tabs[0].root).toBe(root)
    expect(tabs[0].term).toEqual({ id: 'agent', view: 'hidden' })
    expect(tabs[0].terms).toBe(tab.terms)
    expect(tabs[0].files).toBe(tab.files)
    expect(tabs[0].index).toBe(tab.index)
    expect(tabs[0].tree).toBe(tab.tree)
    expect(tabs[0].panes).toBe(tab.panes)
    tabs = setBrowseLocation(tabs, tab.id, { selected: `${other}\\movie.mkv` })
    tabs = setBrowsePreview(tabs, tab.id, true)
    tabs = setBrowseSurface(tabs, tab.id, 'viewer')
    tabs = travelBrowse(tabs, tab.id, -1)
    expect(tabs[0].browse.path).toBe(root)
    expect(tabs[0].browse.preview).toBe(true)
    expect(tabs[0].files).toBe(tab.files)
    expect(tabs[0].term?.id).toBe('agent')
  })

  it('opens a separate top-level session without changing the browsing tab', () => {
    const browser = navigateBrowse([newTab(payload, 'browser')], 'browser', other)[0]
    const result = addTab([browser], { root: other, files: [], index: -1, folder: true }, 'session')
    const tabs = setTabTerm(result.tabs, result.activeId!, { id: 'new-shell', view: 'full' })
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toBe(browser)
    expect(tabs[1].root).toBe(other)
    expect(tabs[1].term?.id).toBe('new-shell')
  })

  it('keeps session labels stable while browsing labels follow the displayed folder', () => {
    let tabs = [newTab(payload, 'session'), newTab({ ...payload, role: 'explorer' }, 'browser')]
    tabs = setTabTerm(tabs, 'session', { id: 'agent', view: 'hidden' })
    tabs = navigateBrowse(navigateBrowse(tabs, 'session', other), 'browser', other)
    expect(tabLabels(tabs)).toEqual(['Prism', 'Movies'])
  })

  it('opens arriving media without dropping browse history or its saved view', () => {
    const tabs = navigateBrowse([newTab(payload, 'project')], 'project', other)
    const before = tabs[0].browse
    const next = receiveFile(tabs, payload, 'unused').tabs[0]
    expect(next.browse.surface).toBe('viewer')
    expect(next.browse.history.slice(0, before.history.length)).toEqual(before.history)
    expect(next.browse.path).toBe(payload.root)
    expect(travelBrowse([next], next.id, -1)[0].browse.path).toBe(other)
  })

  it('restores serialized browse state and stable tab identity without coupling shell cwd', () => {
    const state = navigateBrowseState(newBrowse(root), other)
    const saved = JSON.parse(JSON.stringify(state))
    const tab = newTab(
      { ...payload, restore: true, restoreTabId: 'saved-id', browse: saved, termCwd: root },
      'new-id'
    )
    expect(tab.id).toBe('saved-id')
    expect(tab.root).toBe(root)
    expect(tab.browse).toEqual(state)
    expect(newTab({ ...payload, restoreTabId: 'ignored' }, 'new-id').id).toBe('new-id')
  })

  it('starts explicit folders as folders and legacy file payloads as viewers', () => {
    expect(newTab(payload, 'file').browse.surface).toBe('viewer')
    expect(newTab({ ...payload, folder: true }, 'folder').browse.surface).toBe('folder')
    expect(newTab({ ...payload, files: [], index: -1 }, 'empty').browse.surface).toBe('folder')
  })
})
