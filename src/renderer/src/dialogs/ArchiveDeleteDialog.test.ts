import { describe, expect, it, vi } from 'vitest'
import { ArchiveDeleteDialog } from './ArchiveDeleteDialog'
import { labels, pick, specOf } from './testing'

describe('ArchiveDeleteDialog', () => {
  it('is permanent, so Cancel is the primary', () => {
    const onDelete = vi.fn()
    const s = specOf(ArchiveDeleteDialog({ names: ['a.txt'], count: 1, onCancel: () => {}, onDelete }))
    expect(s.title).toBe('Delete "a.txt" from the archive?')
    expect(s.text).toBe('This is permanent: a zip has no Recycle Bin to take it back from.')
    expect(labels(s)).toEqual(['Cancel', 'Delete'])
    expect(pick(s, 'Cancel').primary).toBe(true)
    expect(pick(s, 'Delete').danger).toBe(true)
    expect(pick(s, 'Delete').primary).toBeFalsy()
    pick(s, 'Delete').onPick()
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('counts several', () => {
    const s = specOf(
      ArchiveDeleteDialog({ names: ['a', 'b'], count: 5, onCancel: () => {}, onDelete: () => {} })
    )
    expect(s.title).toBe('Delete 2 items from the archive?')
    expect(s.text).toContain('take them back from')
  })
})
