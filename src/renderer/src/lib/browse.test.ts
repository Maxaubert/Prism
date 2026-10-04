import { describe, expect, it } from 'vitest'
import {
  browseCrumbs,
  browseLocation,
  browseParent,
  navigateBrowseState,
  newBrowse,
  searchBrowseState,
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
  it('going back or up marks the folder you came out of, and only a direct child', () => {
    // Owner, 2026-09-23: "when you move back to documents, the claude folder
    // should be highlighted, when you go to admin, documents should be".
    const admin = 'C:\\Users\\Admin'
    const documents = `${admin}\\Documents`
    const claude = `${documents}\\Claude`
    let state = newBrowse(admin)
    state = navigateBrowseState(state, documents)
    expect(browseLocation(state).selected).toBeNull() // going IN marks nothing
    state = navigateBrowseState(state, claude)
    state = travelBrowseState(state, -1) // Back
    expect(state.path).toBe(documents)
    expect(browseLocation(state).selected).toBe(claude)
    state = travelBrowseState(state, -1)
    expect(state.path).toBe(admin)
    expect(browseLocation(state).selected).toBe(documents)
    // Forward goes IN again: nothing is marked.
    state = travelBrowseState(state, 1)
    expect(browseLocation(state).selected).toBeNull()
    // Up (the parent, by navigate) marks the same way.
    state = navigateBrowseState(navigateBrowseState(state, claude), documents)
    expect(browseLocation(state).selected).toBe(claude)
    // A jump that is not to the direct parent marks nothing.
    state = navigateBrowseState(navigateBrowseState(state, claude), admin)
    expect(browseLocation(state).selected).toBeNull()
    state = navigateBrowseState(state, other)
    expect(browseLocation(state).selected).toBeNull()
  })

  it('the file on display wins over the folder you came out of', () => {
    const inRoot = `${root}\\readme.md`
    let state = navigateBrowseState(newBrowse(root), `${root}\\src`)
    state = travelBrowseState(state, -1, inRoot)
    expect(browseLocation(state).selected).toBe(inRoot)
  })

  it('returns to the search, sorting and scroll position, but not to an old selection', () => {
    // Owner, 2026-09-22: "no file should be selected when I haven't clicked
    // any". Arriving is not a click, so what an earlier visit selected is not
    // brought back - it made the subfolder you came out of look picked.
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
    expect(browseLocation(state).selected).toBeNull()
    state = updateBrowseLocation(state, { selected: `${other}\film.mkv`, scrollTop: 240 })
    const right = browseLocation(state)
    state = travelBrowseState(state, -1)
    expect(state.path).toBe(root)
    expect(browseLocation(state)).toEqual({ ...left, selected: null })
    state = travelBrowseState(state, 1)
    expect(state.path).toBe(other)
    expect(browseLocation(state)).toEqual({ ...right, selected: null })
    // A revisit by a crumb or a sidebar place is the same: nothing marked.
    // And it leaves the search (#281): the only visit was the results, whose
    // scroll is not the folder's, so it starts at the top.
    state = navigateBrowseState(state, root)
    expect(browseLocation(state).selected).toBeNull()
    expect(browseLocation(state).query).toBe('')
    expect(browseLocation(state).scrollTop).toBe(0)
  })

  it('marks the file on display when you arrive at its folder, and only then', () => {
    let state = updateBrowseLocation(newBrowse(root), { selected: file.path })
    state = navigateBrowseState(state, other, file.path)
    expect(browseLocation(state).selected).toBeNull() // it lives in root, not here
    state = travelBrowseState(state, -1, file.path)
    expect(browseLocation(state).selected).toBe(file.path)
    state = navigateBrowseState(state, other, null)
    state = navigateBrowseState(state, root, file.path)
    expect(browseLocation(state).selected).toBe(file.path)
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

describe('a search is a place in the history (#281)', () => {
  // Owner, 2026-10-04: "if you click into a folder from a search you're not in
  // search anymore, and if you click back then you're back to the search
  // results. if you click something in the sidebar you're not in search
  // anymore, but if you click back arrow you go to the search list again."
  const drive = 'C:\\'
  const sub = `${root}\\src`

  it('starting a search adds an entry; Back is the folder plain, Forward the results', () => {
    let state = updateBrowseLocation(newBrowse(root), { scrollTop: 300 })
    state = searchBrowseState(state, 'notes')
    expect(state.history.map((entry) => [entry.path, entry.query])).toEqual([
      [root, ''],
      [root, 'notes']
    ])
    expect(state.path).toBe(root)
    expect(browseLocation(state).scrollTop).toBe(0)
    state = travelBrowseState(state, -1)
    expect(browseLocation(state)).toMatchObject({ query: '', scrollTop: 300 })
    state = travelBrowseState(state, 1)
    expect(browseLocation(state).query).toBe('notes')
  })

  it('a new query refines the search in place', () => {
    let state = searchBrowseState(newBrowse(root), 'notes')
    state = searchBrowseState(state, 'readme')
    expect(state.history.map((entry) => entry.query)).toEqual(['', 'readme'])
  })

  it('opening a folder from the results leaves search, and Back returns to them', () => {
    let state = searchBrowseState(newBrowse(root), 'src')
    state = navigateBrowseState(state, sub)
    expect(state.path).toBe(sub)
    expect(browseLocation(state).query).toBe('')
    state = travelBrowseState(state, -1)
    expect(state.path).toBe(root)
    expect(browseLocation(state).query).toBe('src')
  })

  it('a sidebar place leaves search, also the folder the search ran in', () => {
    let state = searchBrowseState(newBrowse(drive), 'holiday')
    // Another place: unfiltered.
    let away = navigateBrowseState(state, other)
    expect(browseLocation(away).query).toBe('')
    expect(browseLocation(travelBrowseState(away, -1)).query).toBe('holiday')
    // The SAME place (the C drive while searching C:): unfiltered too, and
    // Back is the search again.
    away = navigateBrowseState(state, 'c:/')
    expect(away.history.map((entry) => entry.query)).toEqual(['', 'holiday', ''])
    expect(browseLocation(away).query).toBe('')
    state = travelBrowseState(away, -1)
    expect(browseLocation(state).query).toBe('holiday')
  })

  it('a revisit takes the plain visit, never a search the place held', () => {
    let state = updateBrowseLocation(newBrowse(root), { scrollTop: 720 })
    state = searchBrowseState(state, 'notes')
    state = updateBrowseLocation(state, { scrollTop: 5000 })
    state = navigateBrowseState(state, other)
    state = navigateBrowseState(state, root)
    expect(browseLocation(state)).toMatchObject({ query: '', scrollTop: 720 })
  })

  it('clearing goes back to the folder it began in, and Forward is the search', () => {
    let state = searchBrowseState(newBrowse(root), 'notes')
    state = searchBrowseState(state, '')
    expect(state.cursor).toBe(0)
    expect(browseLocation(state).query).toBe('')
    state = travelBrowseState(state, 1)
    expect(browseLocation(state).query).toBe('notes')
    // A search with no plain entry before it (a restored tab) clears in place.
    const restored = updateBrowseLocation(newBrowse(root), { query: 'notes' })
    const cleared = searchBrowseState(restored, '')
    expect(cleared.history).toHaveLength(1)
    expect(browseLocation(cleared).query).toBe('')
  })

  it('a search started after going back drops the forward entries', () => {
    let state = navigateBrowseState(newBrowse(root), other)
    state = travelBrowseState(state, -1)
    state = searchBrowseState(state, 'notes')
    expect(state.history.map((entry) => [entry.path, entry.query])).toEqual([
      [root, ''],
      [root, 'notes']
    ])
  })
})
