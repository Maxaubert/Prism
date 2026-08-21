import { beforeEach, describe, expect, it } from 'vitest'
import { isPinned, lastSplitDir, MAX_PINNED, paneAreas, pinPane, saveSplitDir, unpinPane, type PinnedPane } from './panes'

beforeEach(() => localStorage.clear())

const p = (id: string, path: string, dir: PinnedPane['dir'] = 'right'): PinnedPane => ({ id, path, dir })

describe('pinning', () => {
  it('adds up to three pinned panes, then FIFO-evicts the oldest', () => {
    let panes: PinnedPane[] = []
    panes = pinPane(panes, 'a', 'C:/a', 'right')
    panes = pinPane(panes, 'b', 'C:/b', 'right')
    panes = pinPane(panes, 'c', 'C:/c', 'right')
    expect(panes).toHaveLength(MAX_PINNED)
    panes = pinPane(panes, 'd', 'C:/d', 'left')
    expect(panes).toHaveLength(MAX_PINNED)
    expect(panes.map((x) => x.id)).toEqual(['b', 'c', 'd']) // 'a' went first-in-first-out
  })
  it('re-pinning a pinned file moves it instead of duplicating', () => {
    let panes = [p('a', 'C:/a', 'right')]
    panes = pinPane(panes, 'new', 'c:/A', 'top')
    expect(panes).toHaveLength(1)
    expect(panes[0].dir).toBe('top')
  })
  it('unpin removes by id; isPinned matches case-insensitively', () => {
    const panes = [p('a', 'C:/a')]
    expect(isPinned(panes, 'c:/A')).toBe(true)
    expect(unpinPane(panes, 'a')).toEqual([])
  })
})

describe('the quadrant layout', () => {
  it('no pins: the live pane owns the grid', () => {
    expect(paneAreas([]).live).toBe('1 / 1 / 3 / 3')
  })
  it('one pin takes the side it named', () => {
    expect(paneAreas([p('a', 'x', 'left')]).pinned[0]).toBe('1 / 1 / 3 / 2')
    expect(paneAreas([p('a', 'x', 'bottom')]).pinned[0]).toBe('2 / 1 / 3 / 3')
  })
  it('two pins quarter their side; the live pane keeps a half', () => {
    const r = paneAreas([p('a', 'x', 'right'), p('b', 'y', 'right')])
    expect(r.live).toBe('1 / 1 / 3 / 2')
    expect(r.pinned).toEqual(['1 / 2 / 2 / 3', '2 / 2 / 3 / 3'])
  })
  it('three pins fill the corners', () => {
    const r = paneAreas([p('a', 'x'), p('b', 'y'), p('c', 'z')])
    expect(r.live).toBe('1 / 1 / 2 / 2')
    expect(r.pinned).toHaveLength(3)
    expect(new Set([r.live, ...r.pinned]).size).toBe(4) // four distinct corners
  })
})

describe('the remembered direction', () => {
  it('defaults right, round-trips, shrugs at garbage', () => {
    expect(lastSplitDir()).toBe('right')
    saveSplitDir('top')
    expect(lastSplitDir()).toBe('top')
    localStorage.setItem('prism.split.dir', 'diagonal')
    expect(lastSplitDir()).toBe('right')
  })
})
