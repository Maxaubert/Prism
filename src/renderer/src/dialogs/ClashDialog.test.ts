import { describe, expect, it, vi } from 'vitest'
import { ClashDialog } from './ClashDialog'
import { labels, pick, specOf } from './testing'

const fns = (): { onCancel: () => void; onKeepBoth: () => void; onReplace: () => void } => ({
  onCancel: vi.fn(),
  onKeepBoth: vi.fn(),
  onReplace: vi.fn()
})

describe('ClashDialog', () => {
  it('names one clash, counts several', () => {
    const f = fns()
    const one = specOf(ClashDialog({ names: ['a.txt'], where: 'folder', canReplace: true, ...f }))
    expect(one.title).toBe('a.txt is already there')
    expect(one.text).toBe(
      'Keep both lands them beside what is there; replacing sends the old ones to the Recycle Bin.'
    )
    expect(specOf(ClashDialog({ names: ['a', 'b'], where: 'folder', canReplace: true, ...f })).title).toBe(
      '2 names are already taken'
    )
  })

  it('a rename says what Keep both saves it as', () => {
    const s = specOf(
      ClashDialog({ names: ['a.txt'], where: 'folder', suggestion: 'a (2).txt', canReplace: true, ...fns() })
    )
    expect(s.title).toBe('a.txt is already there')
    expect(s.text).toBe('Keep both saves yours as a (2).txt; replacing sends the old one to the Recycle Bin.')
  })

  it('always orders Cancel, Keep both (primary), Replace (red)', () => {
    const f = fns()
    const s = specOf(ClashDialog({ names: ['a.txt'], where: 'folder', canReplace: true, ...f }))
    expect(labels(s)).toEqual(['Cancel', 'Keep both', 'Replace'])
    expect(pick(s, 'Keep both').primary).toBe(true)
    expect(pick(s, 'Replace').danger).toBe(true)
    pick(s, 'Keep both').onPick()
    pick(s, 'Replace').onPick()
    expect(f.onKeepBoth).toHaveBeenCalledOnce()
    expect(f.onReplace).toHaveBeenCalledOnce()
  })

  it('inside a zip there is no Replace and nothing is written yet', () => {
    const f = fns()
    const s = specOf(ClashDialog({ names: ['a.txt'], where: 'archive', canReplace: false, ...f }))
    expect(s.title).toBe('a.txt is already in the archive')
    expect(s.text).toBe('Keep both adds them beside what is there. Nothing has been written yet.')
    expect(labels(s)).toEqual(['Cancel', 'Keep both'])
    expect(specOf(ClashDialog({ names: ['a', 'b'], where: 'archive', canReplace: false, ...f })).title).toBe(
      '2 names are already in the archive'
    )
  })
})