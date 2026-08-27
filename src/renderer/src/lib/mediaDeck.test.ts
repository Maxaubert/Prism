import { describe, expect, it } from 'vitest'
import type { ViewerFile } from '@shared/types'
import { deckOf } from './mediaDeck'

const f = (kind: string, name = 'x'): ViewerFile =>
  ({ path: `C:/${name}`, name, ext: '.x', kind, size: 1, mtimeMs: 1 }) as ViewerFile

const tab = (id: string, file: ViewerFile | null): { id: string; files: ViewerFile[]; index: number } => ({
  id,
  files: file ? [file] : [],
  index: file ? 0 : -1
})

describe('who keeps a player', () => {
  it('gives every tab holding media one, and nothing else one', () => {
    const { entries } = deckOf(
      [tab('a', f('video')), tab('b', f('text')), tab('c', f('audio')), tab('d', null)],
      [],
      'a'
    )
    expect(entries.map((e) => e.tabId)).toEqual(['a', 'c'])
  })

  it('never reorders what is already playing: moving the element would pause it', () => {
    const tabs = [tab('c', f('video')), tab('a', f('video')), tab('b', f('video'))]
    const { order } = deckOf(tabs, ['a', 'b'], 'a')
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('drops a tab that no longer holds media', () => {
    const { order } = deckOf([tab('a', f('video')), tab('b', f('image'))], ['a', 'b'], 'a')
    expect(order).toEqual(['a'])
  })

  it('stands the oldest background player down at the ceiling', () => {
    const tabs = ['a', 'b', 'c', 'd', 'e'].map((id) => tab(id, f('video')))
    const { order } = deckOf(tabs, ['a', 'b', 'c', 'd', 'e'], 'c', 3)
    expect(order).toEqual(['c', 'd', 'e'])
  })

  it('never drops the tab you are looking at', () => {
    const tabs = ['a', 'b', 'c'].map((id) => tab(id, f('video')))
    const { order } = deckOf(tabs, ['a', 'b', 'c'], 'a', 1)
    expect(order).toEqual(['a'])
  })

  it('has nothing to say about a window with no media open', () => {
    expect(deckOf([tab('a', f('text'))], [], 'a').entries).toEqual([])
  })
})
