import { describe, expect, it } from 'vitest'
import type { OpenPayload, ViewerFile } from '@shared/types'
import { addTab, closeTab, emptyTree, newTab, receiveFile, rerootTab, setTabTerm, tabLabels, type Tab } from './tabs'

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

describe('receiveFile', () => {
  it('fills the empty window when nothing is open', () => {
    const r = receiveFile([], payload(SHOOT, ['C:\\shoot\\a.jpg']), 'id1')
    expect(r.tabs).toHaveLength(1)
    expect(r.tabs[0].root).toBe(SHOOT)
    expect(r.activeId).toBe(r.tabs[0].id)
  })

  it('reuses a tab whose root already holds the file, and points it at it', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg', 'C:\\shoot\\b.jpg'])
    const docs = tabOf(DOCS, ['D:\\docs\\r.md'])
    const r = receiveFile([shoot, docs], payload(SHOOT, ['C:\\shoot\\a.jpg', 'C:\\shoot\\b.jpg'], 1), 'unused')
    expect(r.tabs).toHaveLength(2) // no duplicate of the same project
    expect(r.activeId).toBe(shoot.id)
    expect(r.tabs[0].index).toBe(1) // and it moved to the file that arrived
  })

  it('matches a root case-insensitively, the way Windows does', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    const r = receiveFile([shoot], payload(SHOOT.toUpperCase(), ['C:\\shoot\\a.jpg']), 'new')
    expect(r.tabs).toHaveLength(1)
  })

  it('spawns a tab for a root nothing else covers', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    const r = receiveFile([shoot], payload(DOCS, ['D:\\docs\\r.md']), 'id2')
    expect(r.tabs).toHaveLength(2)
    expect(r.tabs[1].root).toBe(DOCS)
    expect(r.activeId).toBe('id2')
  })

  it('refreshes the reused tab file list, so a renamed sibling is not stale', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    const r = receiveFile([shoot], payload(SHOOT, ['C:\\shoot\\a.jpg', 'C:\\shoot\\new.jpg'], 1), 'x')
    expect(r.tabs[0].files.map((v) => v.name)).toEqual(['a.jpg', 'new.jpg'])
  })

  it('keeps the reused tab expanded folders: it is a place you left', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    shoot.tree.expanded.add('C:\\shoot\\sub')
    const r = receiveFile([shoot], payload(SHOOT, ['C:\\shoot\\a.jpg']), 'x')
    expect(r.tabs[0].tree.expanded.has('C:\\shoot\\sub')).toBe(true)
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

  it('falls back to the whole path for a drive root, which has no basename', () => {
    expect(tabLabels([tabOf('C:\\', [])])).toEqual(['C:\\'])
  })
})

describe('emptyTree', () => {
  it('starts with the root expanded and nothing loaded', () => {
    const t = emptyTree(SHOOT)
    expect([...t.expanded]).toEqual([SHOOT])
    expect(t.children).toEqual({})
  })
})

describe('rerootTab', () => {
  it('replaces the tab root in place, keeping its id and its position', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    const music = tabOf('E:\\music', ['E:\\music\\s.mp3'])
    const r = rerootTab([shoot, music], shoot.id, payload(DOCS, ['D:\\docs\\r.md']), 'unused')
    expect(r.tabs).toHaveLength(2)
    expect(r.tabs[0].id).toBe(shoot.id) // same tab, not a new one beside it
    expect(r.tabs[0].root).toBe(DOCS)
    expect(r.tabs[0].files.map((v) => v.name)).toEqual(['r.md'])
    expect(r.activeId).toBe(shoot.id)
  })

  it('gives the rerooted tab a fresh tree: the old folders are not in it', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    shoot.tree.expanded.add('C:\\shoot\\sub')
    const r = rerootTab([shoot], shoot.id, payload(DOCS, ['D:\\docs\\r.md']), 'x')
    expect([...r.tabs[0].tree.expanded]).toEqual([DOCS])
  })

  it('switches to the tab that already holds that root instead of duplicating it', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    const docs = tabOf(DOCS, ['D:\\docs\\r.md'])
    const r = rerootTab([shoot, docs], shoot.id, payload(DOCS, ['D:\\docs\\r.md']), 'x')
    expect(r.tabs).toHaveLength(2)
    expect(r.tabs[0].root).toBe(SHOOT) // the tab you clicked from is left alone
    expect(r.activeId).toBe(docs.id)
  })

  it('rerooting a tab onto its own root is a no-op it stays on', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    const r = rerootTab([shoot], shoot.id, payload(SHOOT, ['C:\\shoot\\a.jpg']), 'x')
    expect(r.tabs).toHaveLength(1)
    expect(r.activeId).toBe(shoot.id)
  })

  it('with no tab to reroot it simply opens one', () => {
    const r = rerootTab([], null, payload(SHOOT, ['C:\\shoot\\a.jpg']), 'fresh')
    expect(r.tabs).toHaveLength(1)
    expect(r.tabs[0].id).toBe('fresh')
    expect(r.activeId).toBe('fresh')
  })
})

describe('addTab', () => {
  it('always spawns, even onto a root that is already open', () => {
    const shoot = tabOf(SHOOT, ['C:\\shoot\\a.jpg'])
    const r = addTab([shoot], payload(SHOOT, ['C:\\shoot\\a.jpg']), 'second')
    // Deliberately unlike receiveFile: + is an explicit "give me a tab", not
    // "show me this file", so it must never silently do nothing.
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

describe('the terminal slot', () => {
  it('a new tab has no terminal', () => {
    expect(tabOf(SHOOT, []).term).toBeNull()
  })
  it('setTabTerm writes only the named tab', () => {
    const a = tabOf(SHOOT, [])
    const b = tabOf(DOCS, [])
    const next = setTabTerm([a, b], a.id, { id: 's1', open: true })
    expect(next[0].term).toEqual({ id: 's1', open: true })
    expect(next[1].term).toBeNull()
  })
  it('rerooting keeps the shell: a dev server survives the tree moving', () => {
    const shoot = tabOf(SHOOT, ['C:@shoot@a.jpg'.split('@').join(String.fromCharCode(92))])
    const withTerm = setTabTerm([shoot], shoot.id, { id: 's1', open: true })
    const r = rerootTab(withTerm, shoot.id, payload(DOCS, []), 'x')
    expect(r.tabs[0].term).toEqual({ id: 's1', open: true })
  })
})
