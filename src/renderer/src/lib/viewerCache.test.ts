import { describe, expect, it } from 'vitest'
import type { ViewerFile } from '@shared/types'
import { MAX_WARM, warmFileOf, warmOf } from './viewerCache'

const f = (kind: string, name = 'x'): ViewerFile =>
  ({ path: `C:/${name}`, name, ext: '.x', kind, size: 1, mtimeMs: 1 }) as ViewerFile

const tab = (id: string, kind = 'pdf', index = 0): { id: string; files: ViewerFile[]; index: number } => ({
  id,
  files: [f(kind, id)],
  index
})

describe('warmFileOf', () => {
  it('takes the file a tab is showing', () => {
    expect(warmFileOf(tab('a'))?.name).toBe('a')
  })

  it('leaves video and audio to the media deck', () => {
    expect(warmFileOf(tab('a', 'video'))).toBeNull()
    expect(warmFileOf(tab('a', 'audio'))).toBeNull()
  })

  it('has nothing to hold for a tab showing no file', () => {
    expect(warmFileOf({ ...tab('a'), index: -1 })).toBeNull()
  })

  it('has nothing to hold for the settings tab', () => {
    expect(warmFileOf({ ...tab('a'), kind: 'settings' })).toBeNull()
  })
})

describe('warmOf', () => {
  it('keeps the active tab', () => {
    const { entries } = warmOf([tab('a')], [], 'a')
    expect(entries.map((e) => e.tabId)).toEqual(['a'])
  })

  it('keeps a tab that has been left, so coming back costs nothing', () => {
    const tabs = [tab('a'), tab('b')]
    const first = warmOf(tabs, [], 'a')
    const after = warmOf(tabs, first.order, 'b')
    expect(after.entries.map((e) => e.tabId).sort()).toEqual(['a', 'b'])
  })

  it('puts the active tab first, so the ceiling drops the least recent', () => {
    const tabs = ['a', 'b', 'c', 'd', 'e'].map((id) => tab(id))
    let order: string[] = []
    for (const id of ['a', 'b', 'c', 'd', 'e']) order = warmOf(tabs, order, id).order
    const { entries } = warmOf(tabs, order, 'e')
    expect(entries).toHaveLength(MAX_WARM)
    expect(entries[0].tabId).toBe('e')
    // 'a' was visited longest ago and is the one released.
    expect(entries.map((x) => x.tabId)).not.toContain('a')
  })

  it('never drops the active tab, however long ago the others were seen', () => {
    const tabs = ['a', 'b', 'c', 'd', 'e'].map((id) => tab(id))
    let order: string[] = []
    for (const id of ['b', 'c', 'd', 'e']) order = warmOf(tabs, order, id).order
    const { entries } = warmOf(tabs, order, 'a')
    expect(entries[0].tabId).toBe('a')
  })

  it('releases everything but the visible tab when not keeping', () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    const warm = warmOf(tabs, ['a', 'b', 'c'], 'b')
    expect(warm.entries).toHaveLength(3)
    const cold = warmOf(tabs, ['a', 'b', 'c'], 'b', false)
    expect(cold.entries.map((e) => e.tabId)).toEqual(['b'])
  })

  it('forgets a tab that has closed', () => {
    const { entries } = warmOf([tab('b')], ['a', 'b'], 'b')
    expect(entries.map((e) => e.tabId)).toEqual(['b'])
  })

  it('forgets a tab that has become a media tab, since the deck owns it now', () => {
    const { entries } = warmOf([tab('a'), tab('b', 'video')], ['a', 'b'], 'a')
    expect(entries.map((e) => e.tabId)).toEqual(['a'])
  })

  it('holds nothing at all when the active tab is media', () => {
    // The deck renders it; this cache must not render it a second time.
    const { entries } = warmOf([tab('a', 'video')], [], 'a')
    expect(entries).toEqual([])
  })
})
