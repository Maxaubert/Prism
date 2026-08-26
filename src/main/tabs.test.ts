import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseTabs, type SavedTabs } from './tabs'

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
  it('keeps roots that still exist, in order', () => {
    const a = folder('shoot')
    const b = folder('docs')
    const saved: SavedTabs = { tabs: [{ root: a }, { root: b }], active: 1 }
    expect(parseTabs(JSON.stringify(saved))).toEqual({ tabs: [{ root: a }, { root: b }], active: 1 })
  })

  it('carries the terminal view, and only sane values of it', () => {
    const a = folder('shoot')
    const b = folder('docs')
    const c = folder('code')
    const saved = {
      tabs: [{ root: a, term: 'full' }, { root: b, term: 'split' }, { root: c, term: 'sideways' }],
      active: 0
    }
    expect(parseTabs(JSON.stringify(saved)).tabs).toEqual([
      { root: a, term: 'full' },
      { root: b, term: 'split' },
      { root: c }
    ])
  })

  it('drops a root that is gone, without a word', () => {
    const a = folder('shoot')
    const saved: SavedTabs = { tabs: [{ root: a }, { root: join(box, 'deleted-last-week') }], active: 0 }
    expect(parseTabs(JSON.stringify(saved)).tabs).toEqual([{ root: a }])
  })

  it('drops a root that is a file rather than a folder', () => {
    const a = folder('shoot')
    const f = join(box, 'notes.txt')
    writeFileSync(f, 'x')
    expect(parseTabs(JSON.stringify({ tabs: [{ root: a }, { root: f }], active: 0 })).tabs).toEqual([
      { root: a }
    ])
  })

  it('pulls the active index back when the tab it named was dropped', () => {
    const a = folder('shoot')
    const saved: SavedTabs = { tabs: [{ root: join(box, 'gone') }, { root: a }], active: 1 }
    expect(parseTabs(JSON.stringify(saved))).toEqual({ tabs: [{ root: a }], active: 0 })
  })

  it('carries the file each tab was showing, when it is still there', () => {
    const a = folder('shoot')
    const f = join(a, 'a.jpg')
    writeFileSync(f, 'x')
    expect(parseTabs(JSON.stringify({ tabs: [{ root: a, file: f }], active: 0 }))).toEqual({
      tabs: [{ root: a, file: f }],
      active: 0
    })
  })

  it('forgets a file that is gone but keeps its tab', () => {
    const a = folder('shoot')
    const saved = { tabs: [{ root: a, file: join(a, 'binned.jpg') }], active: 0 }
    expect(parseTabs(JSON.stringify(saved))).toEqual({ tabs: [{ root: a }], active: 0 })
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
    expect(parseTabs(JSON.stringify(saved)).tabs).toEqual([{ root: a }])
  })

  it("reads the old boolean agent flag as claude, and codex as itself", () => {
    const a = folder('agents')
    const saved = {
      tabs: [
        { root: a, term: 'full', agent: true },
        { root: a, term: 'full', agent: 'codex' },
        { root: a, term: 'full', agent: 'nonsense' }
      ],
      active: 0
    }
    expect(parseTabs(JSON.stringify(saved)).tabs.map((t) => t.agent)).toEqual([
      'claude',
      'codex',
      undefined
    ])
  })

  it('restores the SECOND of two tabs on the same folder as active (field bug)', () => {
    const a = folder('shoot')
    const saved: SavedTabs = {
      tabs: [{ root: a }, { root: a, term: 'full', agent: 'claude' }],
      active: 1
    }
    expect(parseTabs(JSON.stringify(saved))).toEqual({
      tabs: [{ root: a }, { root: a, term: 'full', agent: 'claude' }],
      active: 1
    })
  })

  it('falls back to the first tab when the active tab was dropped with no twin', () => {
    const a = folder('shoot')
    const f = join(box, 'now-a-file')
    writeFileSync(f, 'x')
    // active names a root that no longer restores; a twin of it survives at 1
    const saved: SavedTabs = { tabs: [{ root: join(box, 'gone') }, { root: a }, { root: f }], active: 2 }
    expect(parseTabs(JSON.stringify(saved)).active).toBe(0)
  })

  it('clamps an active index that points nowhere', () => {
    const a = folder('shoot')
    expect(parseTabs(JSON.stringify({ tabs: [{ root: a }], active: 9 })).active).toBe(0)
    expect(parseTabs(JSON.stringify({ tabs: [{ root: a }], active: -3 })).active).toBe(0)
  })
})
