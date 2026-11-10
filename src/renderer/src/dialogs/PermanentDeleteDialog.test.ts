import { describe, expect, it, vi } from 'vitest'
import { PermanentDeleteDialog } from './PermanentDeleteDialog'
import { labels, pick, specOf } from './testing'

describe('PermanentDeleteDialog (Recycle Bin, D14)', () => {
  it('one item: names it and says Windows cannot put it back', () => {
    const s = specOf(PermanentDeleteDialog({ names: ['a.txt'], onCancel: () => {}, onDelete: () => {} }))
    expect(s.title).toBe('Delete permanently?')
    expect(s.text).toBe('"a.txt" is deleted for good. Windows cannot put it back.')
  })

  it('several: counts them', () => {
    const s = specOf(
      PermanentDeleteDialog({ names: ['a', 'b', 'c'], onCancel: () => {}, onDelete: () => {} })
    )
    expect(s.title).toBe('Delete 3 items permanently?')
    expect(s.text).toBe('Everything selected is deleted for good. Windows cannot put it back.')
  })

  it('is final, so Cancel is the primary (the answer Enter picks) and Delete is the danger', () => {
    const onCancel = vi.fn()
    const onDelete = vi.fn()
    const s = specOf(PermanentDeleteDialog({ names: ['a.txt'], onCancel, onDelete }))
    expect(labels(s)).toEqual(['Cancel', 'Delete'])
    expect(pick(s, 'Cancel').primary).toBe(true)
    expect(pick(s, 'Delete').danger).toBe(true)
    expect(pick(s, 'Delete').primary).toBeFalsy()
    pick(s, 'Delete').onPick()
    pick(s, 'Cancel').onPick()
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
