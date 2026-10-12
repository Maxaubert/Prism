import { describe, expect, it, vi } from 'vitest'
import { NameTakenDialog } from './NameTakenDialog'
import { labels, pick, specOf } from './testing'

describe('NameTakenDialog', () => {
  it('names the clash and what Keep both saves it as', () => {
    const onReplace = vi.fn()
    const onKeepBoth = vi.fn()
    const s = specOf(
      NameTakenDialog({ name: 'a.txt', suggestion: 'a (2).txt', onCancel: () => {}, onReplace, onKeepBoth })
    )
    expect(s.title).toBe('That name is taken')
    expect(s.text).toBe(
      'This folder already has a a.txt. Keeping both saves yours as a (2).txt; replacing it sends the old one to the Recycle Bin.'
    )
    expect(labels(s)).toEqual(['Cancel', 'Replace', 'Keep both'])
    expect(pick(s, 'Replace').danger).toBe(true)
    expect(pick(s, 'Keep both').primary).toBe(true)
    pick(s, 'Replace').onPick()
    pick(s, 'Keep both').onPick()
    expect(onReplace).toHaveBeenCalledOnce()
    expect(onKeepBoth).toHaveBeenCalledOnce()
  })
})
