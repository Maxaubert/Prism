import { describe, expect, it } from 'vitest'
import type { ViewerFile } from '@shared/types'
import { newBrowse } from '../browse'
import { tabCrumbs } from './tabCrumbs'
import { newTab, type Tab, type TabState } from './tabs'

const video: ViewerFile = { path: 'C:\\films\\a.mp4', name: 'a.mp4', ext: '.mp4', kind: 'video', size: 1, mtimeMs: 0 }
const text: ViewerFile = { path: 'C:\\films\\notes.txt', name: 'notes.txt', ext: '.txt', kind: 'text', size: 1, mtimeMs: 0 }

function tab(id: string, root = 'C:\\films', files: ViewerFile[] = [], index = -1): Tab {
  return newTab({ root, files, index, browse: newBrowse(root, 'folder') }, id)
}

const state = (tabs: Tab[], activeId: string | null): TabState => ({ tabs, activeId })

describe('tabCrumbs (#322)', () => {
  it('says nothing for the same state', () => {
    const s = state([tab('a')], 'a')
    expect(tabCrumbs(s, s)).toEqual([])
    expect(tabCrumbs(s, { ...s })).toEqual([])
  })

  it('says a tab opened', () => {
    const a = tab('a')
    const b = tab('b', 'C:\\code')
    expect(tabCrumbs(state([a], 'a'), state([a, b], 'b'))).toEqual([
      { a: 'tab-open', fields: { id: 'b', kind: 'explorer', root: 'C:\\code' } }
    ])
  })

  it('says a tab closed and the one switched to', () => {
    const a = tab('a')
    const b = tab('b')
    expect(tabCrumbs(state([a, b], 'b'), state([a], 'a'))).toEqual([
      { a: 'tab-close', fields: { id: 'b', kind: 'explorer' } },
      { a: 'tab-switch', fields: { id: 'a' } }
    ])
  })

  it('says a video or a sound reached the player, once', () => {
    const shown = tab('a', 'C:\\films', [text, video], 0)
    const t = { ...shown, browse: { ...shown.browse, preview: false } }
    const playingVideo = { ...t, index: 1 }
    expect(tabCrumbs(state([t], 'a'), state([playingVideo], 'a'))).toEqual([
      { a: 'player-open', fields: { id: 'a', path: video.path, kind: 'video' } }
    ])
    expect(tabCrumbs(state([playingVideo], 'a'), state([{ ...playingVideo }], 'a'))).toEqual([])
  })

  it('keeps a file the preview pane shows beside the list for Detailed logging', () => {
    const t = tab('a', 'C:\\films', [text, video], 0)
    const previewing = { ...t, browse: { ...t.browse, preview: true } }
    expect(tabCrumbs(state([previewing], 'a'), state([{ ...previewing, index: 1 }], 'a'))).toEqual([
      { a: 'player-open', fields: { id: 'a', path: video.path, kind: 'video' }, often: true }
    ])
    // Opened full (the viewer surface): said at the quiet level, preview or not.
    const full = { ...previewing, browse: { ...previewing.browse, surface: 'viewer' as const } }
    expect(tabCrumbs(state([full], 'a'), state([{ ...full, index: 1 }], 'a'))).toEqual([
      { a: 'player-open', fields: { id: 'a', path: video.path, kind: 'video' } }
    ])
  })
})
