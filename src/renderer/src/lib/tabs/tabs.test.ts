import { describe, expect, it } from 'vitest'
import type { OpenPayload, ViewerFile } from '@shared/types'
import {
  addTab,
  navigateBrowse,
  travelBrowse,
  setBrowsePreview,
  replaceBrowsePath,
  setBrowseScroll,
  searchBrowse,
  addExplorerTab,
  ensurePinnedExplorer,
  isExplorerTab,
  frontPinnedExplorer,
  closeTab,
  newTab,
  openSettingsTab,
  toggleSettingsTab,
  reorderTabs,
  tabLabels,
  type Tab
} from './tabs'
import { newBrowse } from '../browse'

const f = (path: string): ViewerFile => ({
  path,
  name: path.split('\\').pop() ?? path,
  ext: '.jpg',
  kind: 'image',
  size: 0,
  mtimeMs: 0
})

const payload = (root: string, files: string[], index = 0): OpenPayload => ({
  root,
  files: files.map(f),
  index
})

const SHOOT = 'C:\\shoot'
const DOCS = 'D:\\docs'

const tabOf = (root: string, files: string[], index = 0): Tab =>
  newTab(payload(root, files, index), `t-${root}`)

describe('Explorer tabs', () => {
  it('every tab is an Explorer tab, whatever a payload says (2026-10-26)', () => {
    const p = payload(SHOOT, ['C:\\shoot\\a.jpg', 'C:\\shoot\\b.jpg'], 0)
    expect(newTab(p, 'a').role).toBe('explorer')
    expect(isExplorerTab(newTab(p, 'a'))).toBe(true)
    expect(isExplorerTab(openSettingsTab([], 's').tabs[0])).toBe(false)
  })

  it('a file in a tab opens in the full viewer, a folder on its list', () => {
    const p = payload(SHOOT, ['C:\\shoot\\a.jpg'], 0)
    expect(newTab(p, 'file').browse.surface).toBe('viewer')
    expect(newTab({ ...p, index: -1 }, 'folder').browse.surface).toBe('folder')
  })

  it('restores an empty folder tab without mounting the first listed file', () => {
    const p = payload(SHOOT, ['C:\\shoot\\a.jpg'], -1)
    const restored = newTab({ ...p, browse: newBrowse(SHOOT, 'folder'),
      restore: true, restoreTabId: 'empty-folder' }, 'unused')
    expect(restored.id).toBe('empty-folder')
    expect(restored.index).toBe(-1)
    expect(restored.browse.surface).toBe('folder')
  })
  it('does not select or mount a file when Explorer opens a nonempty folder', () => {
    const p = payload(SHOOT, ['C:\\shoot\\a.jpg'], -1)
    const pinned = addExplorerTab([], p, 'explorer', true).tabs[0]
    const ordinary = addExplorerTab([], p, 'ordinary').tabs[0]
    expect(pinned.files).toHaveLength(1)
    expect(pinned.index).toBe(-1)
    expect(ordinary.index).toBe(-1)
    expect(newTab({ ...p, role: 'explorer', restore: true }, 'restored').index).toBe(-1)
    expect(newTab({ ...p, role: 'explorer', index: 0 }, 'opened-file').index).toBe(0)
  })

  it('restores the pinned Explorer without resetting its location or duplicating owners', () => {
    const p = payload(SHOOT, [])
    const browser = addExplorerTab([], p, 'explorer', true).tabs[0]
    browser.browse = newBrowse(DOCS)
    const other = tabOf(SHOOT, [])
    const extra = { ...browser, id: 'extra' }
    const restored = ensurePinnedExplorer([other, browser, extra], p, 'unused')
    expect(restored.map((tab) => tab.id)).toEqual(['explorer', other.id, 'extra'])
    expect(restored[0]).toBe(browser)
    expect(restored[0].browse.path).toBe(DOCS)
    expect(restored[1]).toBe(other)
    expect(restored[2].pinned).toBe(false)
    expect(ensurePinnedExplorer(restored, p, 'unused')).toEqual(restored)
  })

  it('adds closable Explorer tabs beside the permanent one', () => {
    const p = payload(SHOOT, [])
    const pinned = addExplorerTab([], p, 'explorer', true)
    const extra = addExplorerTab(pinned.tabs, p, 'extra')
    expect(extra.activeId).toBe('extra')
    expect(extra.tabs.map((tab) => tab.role)).toEqual(['explorer', 'explorer'])
    expect(closeTab(extra.tabs, 'extra', 'extra').activeId).toBe('explorer')
    expect(closeTab(extra.tabs, 'explorer', 'extra').tabs).toEqual(extra.tabs)
  })

  it('keeps the permanent Explorer first when other tabs reorder', () => {
    const first = addExplorerTab([], payload(SHOOT, []), 'explorer', true).tabs[0]
    const a = tabOf(SHOOT, [])
    const b = tabOf(DOCS, [])
    expect(reorderTabs([first, a, b], first.id, 3)).toEqual([first, a, b])
    expect(reorderTabs([first, a, b], b.id, 0)).toEqual([first, b, a])
  })

  it('labels a tab by the folder it shows and names the permanent Explorer', () => {
    const first = addExplorerTab([], payload(SHOOT, []), 'explorer', true).tabs[0]
    const extra = addExplorerTab([], payload(DOCS, []), 'extra').tabs[0]
    const moved = { ...tabOf(SHOOT, []), browse: newBrowse(DOCS) }
    expect(tabLabels([first, extra, moved])).toEqual(['Explorer', 'docs', 'docs'])
  })
})

describe('frontPinnedExplorer', () => {
  const explorerAnd = (preview: boolean): Tab[] => {
    const browser = addExplorerTab([], payload(DOCS, [], -1), 'explorer', true).tabs[0]
    return [
      { ...browser, browse: { ...browser.browse, preview } },
      tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    ]
  }
  it('brings the pinned Explorer to the front', () => {
    const tabs = explorerAnd(true)
    const r = frontPinnedExplorer(tabs, false)!
    expect(r.activeId).toBe('explorer')
    expect(r.tabs[1]).toBe(tabs[1])
  })
  it('turns the preview pane on for the Preview mode, and leaves it alone for Full view', () => {
    expect(frontPinnedExplorer(explorerAnd(false), true)!.tabs[0].browse.preview).toBe(true)
    expect(frontPinnedExplorer(explorerAnd(false), false)!.tabs[0].browse.preview).toBe(false)
  })
  it('is null when there is no pinned Explorer', () => {
    expect(frontPinnedExplorer([tabOf(SHOOT, ['C:\\shoot\\a.jpg'])], true)).toBeNull()
  })
})

describe('closeTab', () => {
  const three = (): Tab[] => [
    tabOf(SHOOT, ['C:\\shoot\\a.jpg']),
    tabOf(DOCS, ['D:\\docs\\r.md']),
    tabOf('E:\\music', ['E:\\music\\s.mp3'])
  ]

  it('hands the active mark to the right-hand neighbour', () => {
    const tabs = three()
    const r = closeTab(tabs, tabs[1].id, tabs[1].id)
    expect(r.tabs.map((t) => t.root)).toEqual([SHOOT, 'E:\\music'])
    expect(r.activeId).toBe(tabs[2].id)
  })

  it('falls back to the left when the closed tab was last', () => {
    const tabs = three()
    const r = closeTab(tabs, tabs[2].id, tabs[2].id)
    expect(r.activeId).toBe(tabs[1].id)
  })

  it('leaves the active tab alone when a different one closes', () => {
    const tabs = three()
    const r = closeTab(tabs, tabs[0].id, tabs[2].id)
    expect(r.activeId).toBe(tabs[2].id)
  })

  it('closing the last tab leaves an empty window, not a missing one', () => {
    const tabs = [tabOf(SHOOT, ['C:\\shoot\\a.jpg'])]
    const r = closeTab(tabs, tabs[0].id, tabs[0].id)
    expect(r.tabs).toEqual([])
    expect(r.activeId).toBeNull()
  })
})

describe('tabLabels', () => {
  it('uses the root basename', () => {
    expect(tabLabels([tabOf(SHOOT, []), tabOf(DOCS, [])])).toEqual(['shoot', 'docs'])
  })

  it('disambiguates by parent ONLY when two basenames collide', () => {
    const tabs = [
      tabOf('C:\\shoot\\assets', []),
      tabOf('C:\\docs\\assets', []),
      tabOf('C:\\music', [])
    ]
    expect(tabLabels(tabs)).toEqual(['assets — shoot', 'assets — docs', 'music'])
  })

  it('two tabs on the SAME folder stay plainly named: there is nothing to tell apart', () => {
    const home = 'C:@Users@Admin'.split('@').join(String.fromCharCode(92))
    expect(tabLabels([tabOf(home, []), tabOf(home, [])])).toEqual(['Admin', 'Admin'])
  })
  it('same-root pairs stay plain even in mixed company', () => {
    const home = 'C:@Users@Admin'.split('@').join(String.fromCharCode(92))
    const other = 'D:@backup@Admin'.split('@').join(String.fromCharCode(92))
    expect(tabLabels([tabOf(home, []), tabOf(home, []), tabOf(other, [])])).toEqual([
      'Admin — Users',
      'Admin — Users',
      'Admin — backup'
    ])
  })

  it('falls back to the whole path for a drive root, which has no basename', () => {
    expect(tabLabels([tabOf('C:\\', [])])).toEqual(['C:\\'])
  })
})

describe('addTab', () => {
  it('always spawns, even onto a root that is already open', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    const r = addTab([shoot], payload(SHOOT, ['C:\\shoot\\a.jpg']), 'second')
    // + is an explicit "give me a tab", not "show me this file", so it must
    // never silently do nothing.
    expect(r.tabs).toHaveLength(2)
    expect(r.activeId).toBe('second')
  })

  it('puts the new tab at the end and makes it active', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    const r = addTab([shoot], payload(DOCS, ['D:\\docs\\r.md']), 'n')
    expect(r.tabs.map((t) => t.root)).toEqual([SHOOT, DOCS])
    expect(r.activeId).toBe('n')
  })
})

describe('the settings tab', () => {
  it('opens once and re-activates after that', () => {
    const a = tabOf(SHOOT, [])
    const first = openSettingsTab([a], 'set-1')
    expect(first.tabs).toHaveLength(2)
    expect(first.tabs[1].kind).toBe('settings')
    const again = openSettingsTab(first.tabs, 'set-2')
    expect(again.tabs).toHaveLength(2)
    expect(again.activeId).toBe('set-1')
  })
  it('is labelled Settings', () => {
    const st = openSettingsTab([], 's').tabs
    expect(tabLabels(st)).toEqual(['Settings'])
  })
})

describe('reorderTabs', () => {
  const strip = (list: string[]): Tab[] =>
    list.map((id) => newTab(payload('C:\\root', ['C:\\root\\one.png']), id))
  const ids = (tabs: Tab[]): string[] => tabs.map((t) => t.id)

  it('moves a tab later, accounting for its own removal', () => {
    expect(ids(reorderTabs(strip(['a', 'b', 'c']), 'a', 2))).toEqual(['b', 'a', 'c'])
    expect(ids(reorderTabs(strip(['a', 'b', 'c']), 'a', 3))).toEqual(['b', 'c', 'a'])
  })

  it('moves a tab earlier', () => {
    expect(ids(reorderTabs(strip(['a', 'b', 'c']), 'c', 0))).toEqual(['c', 'a', 'b'])
    expect(ids(reorderTabs(strip(['a', 'b', 'c']), 'b', 0))).toEqual(['b', 'a', 'c'])
  })

  it('is a no-op for its own slot, an unknown id, or a wild index', () => {
    expect(ids(reorderTabs(strip(['a', 'b', 'c']), 'b', 1))).toEqual(['a', 'b', 'c'])
    expect(ids(reorderTabs(strip(['a', 'b', 'c']), 'zz', 0))).toEqual(['a', 'b', 'c'])
    expect(ids(reorderTabs(strip(['a', 'b', 'c']), 'a', 99))).toEqual(['b', 'c', 'a'])
  })
})

describe('the gear', () => {
  const settings = (id: string): Tab => ({
    id,
    kind: 'settings',
    root: '',
    browse: newBrowse(''),
    files: [],
    index: -1
  })

  it('opens settings when there are none', () => {
    const st = toggleSettingsTab([], null, 'settings-1')
    expect(st.tabs).toHaveLength(1)
    expect(st.tabs[0].kind).toBe('settings')
    expect(st.activeId).toBe('settings-1')
  })

  it('CLOSES settings when they are the tab you are looking at', () => {
    const tabs = [tabOf('C:\\a', ['C:\\a\\one.jpg']), settings('s')]
    const st = toggleSettingsTab(tabs, 's', 'settings-2')
    expect(st.tabs.map((t) => t.kind ?? 'file')).toEqual(['file'])
    expect(st.activeId).toBe(tabs[0].id)
  })

  it('brings settings FORWARD when they are open behind something else', () => {
    // Closing a tab the user cannot see would be the wrong reading of a click
    // that plainly means "show me".
    const tabs = [tabOf('C:\\a', ['C:\\a\\one.jpg']), settings('s')]
    const st = toggleSettingsTab(tabs, tabs[0].id, 'settings-2')
    expect(st.tabs).toHaveLength(2)
    expect(st.activeId).toBe('s')
  })

  it('never makes a second settings tab', () => {
    const tabs = [settings('s'), tabOf('C:\\a', ['C:\\a\\one.jpg'])]
    const st = toggleSettingsTab(tabs, tabs[1].id, 'settings-2')
    expect(st.tabs.filter((t) => t.kind === 'settings')).toHaveLength(1)
  })
})

describe('replaceBrowsePath (review of #300)', () => {
  it('rewrites the current history entry instead of pushing one, so Back gets past a gone folder', () => {
    const tab: Tab = { ...tabOf('C:\\a', []), id: 't1', browse: newBrowse('C:\\a') }
    const went = navigateBrowse([tab], 't1', 'C:\\a\\x.zip\\gone')
    const fixed = replaceBrowsePath(went, 't1', 'C:\\a\\x.zip')
    expect(fixed[0].browse.history.map((h) => h.path)).toEqual(['C:\\a', 'C:\\a\\x.zip'])
    expect(fixed[0].browse.cursor).toBe(1)
    expect(fixed[0].browse.path).toBe('C:\\a\\x.zip')
  })
})

describe('going into a folder clears the preview (#300 review)', () => {
  const explorer = (preview: boolean, index: number): Tab => ({
    ...tabOf('C:\\a', ['C:\\a\\x.zip', 'C:\\a\\b.jpg'], index),
    id: 't1',
    index,
    browse: { ...newBrowse('C:\\a'), preview }
  })

  it('drops the file on display and keeps an open pane open, empty', () => {
    const went = navigateBrowse([explorer(true, 0)], 't1', 'C:\\a\\x.zip')[0]
    expect(went.index).toBe(-1)
    expect(went.browse.previewHeld).toBe(true)
    // Further in, and Back out again: still open, still empty.
    const deeper = navigateBrowse([went], 't1', 'C:\\a\\x.zip\\src')[0]
    expect(deeper.browse.previewHeld).toBe(true)
    const back = travelBrowse([deeper], 't1', -2)[0]
    expect(back.browse.path).toBe('C:\\a')
    expect(back.index).toBe(-1)
    expect(back.browse.previewHeld).toBe(true)
  })

  it('leaves a shut pane shut and a same-folder navigation alone', () => {
    const shut = navigateBrowse([explorer(true, -1)], 't1', 'C:\\a\\x.zip')[0]
    expect(shut.browse.previewHeld).toBeUndefined()
    const off = navigateBrowse([explorer(false, 0)], 't1', 'C:\\a\\x.zip')[0]
    expect(off.index).toBe(-1)
    expect(off.browse.previewHeld).toBeUndefined()
    const same = navigateBrowse([explorer(true, 1)], 't1', 'C:\\a')[0]
    expect(same.index).toBe(1)
    expect(same.browse.previewHeld).toBeUndefined()
  })

  it('a pane put away forgets it was held', () => {
    const went = navigateBrowse([explorer(true, 0)], 't1', 'C:\\a\\x.zip')
    const off = setBrowsePreview(went, 't1', false)[0]
    expect(off.browse.previewHeld).toBeUndefined()
    expect(setBrowsePreview([off], 't1', true)[0].browse.previewHeld).toBeUndefined()
  })
})

describe('setBrowseScroll (review, 2026-10-16)', () => {
  const start = (): Tab[] => [{ ...tabOf('C:\\a', []), id: 't1', browse: newBrowse('C:\\a') }]
  const placeOf = (tabs: Tab[]) => {
    const b = tabs[0].browse
    const e = b.history[b.cursor]
    return { cursor: b.cursor, path: e.path, query: e.query, sort: e.sort }
  }

  it('a position that settles after a navigation lands on the entry it was made in', () => {
    const tabs = start()
    const at = placeOf(tabs)
    const went = navigateBrowse(tabs, 't1', 'C:\\a\\b')
    const kept = setBrowseScroll(went, 't1', at, 480)
    expect(kept[0].browse.history[0].scrollTop).toBe(480)
    expect(kept[0].browse.history[1].scrollTop).toBe(0)
    // ...so Back finds it there.
    expect(travelBrowse(kept, 't1', -1)[0].browse.history[0].scrollTop).toBe(480)
  })

  it('answers the same array when there is nothing to change, so the setState does nothing', () => {
    const tabs = start()
    expect(setBrowseScroll(tabs, 't1', placeOf(tabs), 0)).toBe(tabs)
  })

  it('leaves an entry that has since changed what it shows', () => {
    const tabs = searchBrowse(start(), 't1', 'cat')
    const at = placeOf(tabs)
    const refined = searchBrowse(tabs, 't1', 'cats')
    expect(setBrowseScroll(refined, 't1', at, 900)).toBe(refined)
  })
})
