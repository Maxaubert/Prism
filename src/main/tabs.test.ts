import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseTabs, tabsWriter, type SavedTabs } from './tabs'

let box = ''
beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), 'prism-tabs-'))
})
afterEach(() => rmSync(box, { recursive: true, force: true }))

const folder = (name: string): string => {
  const p = join(box, name)
  mkdirSync(p, { recursive: true })
  return p
}

describe('parseTabs', () => {
  it('migrates a saved project tab to an Explorer tab at its folder, keeping the open file (2026-10-26)', () => {
    const root = folder('project')
    const sub = folder('project/shots')
    const file = join(sub, 'notes.txt')
    writeFileSync(file, 'the open file')
    const browse = { path: sub, history: [], cursor: 0, surface: 'folder', preview: false }
    const parsed = parseTabs(
      JSON.stringify({
        tabs: [
          { id: 'p1', root, role: 'project', file, browse, open: [root, sub], panes: [] },
          { id: 'p2', root, file }
        ],
        active: 0
      })
    )
    const [first, second] = parsed.tabs
    expect(first).toMatchObject({ id: 'p1', root, role: 'explorer', file })
    expect(first.pinned).toBeUndefined()
    // The folder it was showing is kept; the open file puts the viewer in front.
    expect(first.browse?.path).toBe(sub)
    expect(first.browse?.surface).toBe('viewer')
    // A project tab saved before `browse` existed has none: the page opens its root.
    expect(second).toEqual({ id: 'p2', root, role: 'explorer', file })
    expect('open' in first).toBe(false)
    expect('panes' in first).toBe(false)
  })
  it('a migrated project tab that had no file opens on its folder, not on an empty viewer', () => {
    const root = folder('empty-workspace')
    // The old "empty workspace": surface viewer, nothing open.
    const browse = { path: root, surface: 'viewer', history: [], cursor: 0, preview: false }
    const parsed = parseTabs(JSON.stringify({ tabs: [{ root, role: 'project', browse }], active: 0 }))
    expect(parsed.tabs[0].file).toBeUndefined()
    expect(parsed.tabs[0].browse?.surface).toBe('folder')
  })
  it('retains one permanent Explorer while keeping every tab and active owner', () => {
    const root = folder('home')
    const parsed = parseTabs(JSON.stringify({ tabs: [
      { id: 'project', root, role: 'project', pinned: true },
      { id: 'explorer', root, role: 'explorer', pinned: true },
      { id: 'extra', root, role: 'explorer', pinned: true }
    ], active: 2 }))
    expect(parsed).toEqual({ tabs: [
      { id: 'project', root, role: 'explorer' },
      { id: 'explorer', root, role: 'explorer', pinned: true },
      { id: 'extra', root, role: 'explorer' }
    ], active: 2 })
  })

  it('ignores invalid tab roles and does not pin legacy tabs', () => {
    const root = folder('legacy')
    expect(parseTabs(JSON.stringify({ tabs: [
      { root, role: 'invalid', pinned: true },
      { root, pinned: true }
    ], active: 1 }))).toEqual({ tabs: [
      { root, role: 'explorer' },
      { root, role: 'explorer' }
    ], active: 1 })
  })
  it('keeps the first saved ID and regenerates duplicate owners on restore', () => {
    const root = folder('project')
    const parsed = parseTabs(
      JSON.stringify({
        tabs: [
          { id: 'same', root },
          { id: 'same', root }
        ],
        active: 1
      })
    )
    expect(parsed).toEqual({
      tabs: [
        { id: 'same', root, role: 'explorer' },
        { root, role: 'explorer' }
      ],
      active: 1
    })
  })
  it('keeps roots that still exist, in order', () => {
    const a = folder('shoot')
    const b = folder('docs')
    const saved: SavedTabs = { tabs: [{ root: a }, { root: b }], active: 1 }
    expect(parseTabs(JSON.stringify(saved))).toEqual({
      tabs: [
        { root: a, role: 'explorer' },
        { root: b, role: 'explorer' }
      ],
      active: 1
    })
  })

  it('ignores the terminal view an old strip carries (2026-10-26)', () => {
    const a = folder('shoot')
    const b = folder('docs')
    const saved = {
      tabs: [
        { root: a, term: 'full', terms: 3 },
        { root: b, term: 'split', cwd: b, agent: 'claude' }
      ],
      active: 0
    }
    expect(parseTabs(JSON.stringify(saved)).tabs).toEqual([
      { root: a, role: 'explorer' },
      { root: b, role: 'explorer' }
    ])
  })

  it('drops a root that is gone, without a word', () => {
    const a = folder('shoot')
    const saved: SavedTabs = {
      tabs: [{ root: a }, { root: join(box, 'deleted-last-week') }],
      active: 0
    }
    expect(parseTabs(JSON.stringify(saved)).tabs).toEqual([{ root: a, role: 'explorer' }])
  })

  it('drops a root that is a file rather than a folder', () => {
    const a = folder('shoot')
    const f = join(box, 'notes.txt')
    writeFileSync(f, 'x')
    expect(parseTabs(JSON.stringify({ tabs: [{ root: a }, { root: f }], active: 0 })).tabs).toEqual(
      [{ root: a, role: 'explorer' }]
    )
  })

  it('pulls the active index back when the tab it named was dropped', () => {
    const a = folder('shoot')
    const saved: SavedTabs = { tabs: [{ root: join(box, 'gone') }, { root: a }], active: 1 }
    expect(parseTabs(JSON.stringify(saved))).toEqual({ tabs: [{ root: a, role: 'explorer' }], active: 0 })
  })

  it('carries the file each tab was showing, when it is still there', () => {
    const a = folder('shoot')
    const f = join(a, 'a.jpg')
    writeFileSync(f, 'x')
    expect(parseTabs(JSON.stringify({ tabs: [{ root: a, file: f }], active: 0 }))).toEqual({
      tabs: [{ root: a, role: 'explorer', file: f }],
      active: 0
    })
  })

  it('forgets a file that is gone but keeps its tab', () => {
    const a = folder('shoot')
    const saved = { tabs: [{ root: a, file: join(a, 'binned.jpg') }], active: 0 }
    expect(parseTabs(JSON.stringify(saved))).toEqual({ tabs: [{ root: a, role: 'explorer' }], active: 0 })
  })

  it('a corrupt or foreign file is simply no tabs', () => {
    expect(parseTabs('not json at all')).toEqual({ tabs: [], active: 0 })
    expect(parseTabs('{"tabs":"nonsense"}')).toEqual({ tabs: [], active: 0 })
    expect(parseTabs('null')).toEqual({ tabs: [], active: 0 })
    expect(parseTabs('')).toEqual({ tabs: [], active: 0 })
  })

  it('ignores entries that are not shaped like a tab', () => {
    const a = folder('shoot')
    const saved = { tabs: [{ root: a }, { nope: 1 }, 'string', null], active: 0 }
    expect(parseTabs(JSON.stringify(saved)).tabs).toEqual([{ root: a, role: 'explorer' }])
  })

  it('restores the SECOND of two tabs on the same folder as active (field bug)', () => {
    const a = folder('shoot')
    const saved: SavedTabs = {
      tabs: [{ root: a }, { root: a }],
      active: 1
    }
    expect(parseTabs(JSON.stringify(saved))).toEqual({
      tabs: [
        { root: a, role: 'explorer' },
        { root: a, role: 'explorer' }
      ],
      active: 1
    })
  })

  it('falls back to the first tab when the active tab was dropped with no twin', () => {
    const a = folder('shoot')
    const f = join(box, 'now-a-file')
    writeFileSync(f, 'x')
    // active names a root that no longer restores; a twin of it survives at 1
    const saved: SavedTabs = {
      tabs: [{ root: join(box, 'gone') }, { root: a }, { root: f }],
      active: 2
    }
    expect(parseTabs(JSON.stringify(saved)).active).toBe(0)
  })

  it('clamps an active index that points nowhere', () => {
    const a = folder('shoot')
    expect(parseTabs(JSON.stringify({ tabs: [{ root: a }], active: 9 })).active).toBe(0)
    expect(parseTabs(JSON.stringify({ tabs: [{ root: a }], active: -3 })).active).toBe(0)
  })
})

describe('the bulk of a strip off this PC (2026-10-16: sync stats waited out the SMB timeout)', () => {
  it('keeps history on a share unchecked, and still drops gone local ones', () => {
    const root = folder('here')
    const gone = join(box, 'gone')
    const share = '\\\\prism-test-offline.invalid\\share\\photos'
    const at = (path: string): object => ({ path, selected: null, scrollTop: 0, query: '', sort: { key: 'name', direction: 'asc' } })
    const browse = { path: root, history: [at(share), at(gone), at(root)], cursor: 2, surface: 'folder', preview: false }
    const parsed = parseTabs(
      JSON.stringify({ tabs: [{ root, role: 'explorer', browse, open: [join(share, '2026'), join(root, 'gone')] }], active: 0 })
    )
    expect(parsed.tabs[0].browse?.history.map((h) => h.path)).toEqual([share, root])
    expect(parsed.tabs[0].browse?.cursor).toBe(1)
    // The tree's open folders went with the tree (2026-10-26): never read.
    expect('open' in parsed.tabs[0]).toBe(false)
  })
})

describe('places inside an archive (#300)', () => {
  it('keeps history entries inside a zip that is still there', () => {
    const root = folder('downloads')
    const zip = join(root, 'w.zip')
    writeFileSync(zip, 'zip bytes')
    const inside = join(zip, 'Wind', 'src')
    const sort = { key: 'packed', direction: 'desc' }
    const browse = {
      path: inside,
      history: [
        { path: root, selected: null, scrollTop: 0, query: '', sort },
        { path: inside, selected: null, scrollTop: 0, query: '', sort }
      ],
      cursor: 1,
      surface: 'folder',
      preview: true
    }
    const parsed = parseTabs(
      JSON.stringify({ tabs: [{ root, role: 'explorer', browse, open: [zip, join(zip, 'Wind')] }], active: 0 })
    )
    expect(parsed.tabs[0].browse?.path).toBe(inside)
    expect(parsed.tabs[0].browse?.history.map((h) => h.path)).toEqual([root, inside])
    expect(parsed.tabs[0].browse?.history[1].sort.key).toBe('packed')
  })

  it('drops them when the zip has gone', () => {
    const root = folder('downloads2')
    const inside = join(root, 'gone.zip', 'Wind')
    const browse = {
      path: inside,
      history: [{ path: inside, selected: null, scrollTop: 0, query: '', sort: { key: 'name', direction: 'asc' } }],
      cursor: 0,
      surface: 'folder',
      preview: true
    }
    const parsed = parseTabs(JSON.stringify({ tabs: [{ root, role: 'explorer', browse }], active: 0 }))
    expect(parsed.tabs[0].browse).toBeUndefined()
  })
})

describe('the tab strip is saved off the main thread (owner, 2026-10-12)', () => {
  const state = (n: number): SavedTabs => ({ tabs: [{ root: `C:\r${n}` }], active: 0 }) as unknown as SavedTabs
  it('writes the newest state, whole', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabs-'))
    const file = join(dir, 'tabs.json')
    const w = tabsWriter(() => file)
    await Promise.all([w.write(state(1)), w.write(state(2))])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(state(2))
    expect(readdirSync(dir)).toEqual(['tabs.json'])
  })
  it('a write still in flight never lands over the quit flush', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabs-'))
    const file = join(dir, 'tabs.json')
    const w = tabsWriter(() => file)
    const late = w.write(state(1))
    w.flushSync(state(2))
    await late
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(state(2))
    expect(readdirSync(dir)).toEqual(['tabs.json'])
  })
})
