import { describe, expect, it } from 'vitest'
import { ArchiveDeleteDialog } from './ArchiveDeleteDialog'
import { labels, pick, specOf } from './testing'

describe('ArchiveDeleteDialog (a zip member is always permanent; owner, 2026-11-10, #500)', () => {
  it('is the permanent question: no middle button, Cancel has the focus', () => {
    const s = specOf(ArchiveDeleteDialog({ names: ['a.txt'], onCancel: () => {}, onDelete: () => {} }))
    expect(s.title).toBe('Delete a.txt permanently?')
    expect(labels(s)).toEqual(['Cancel', 'Delete permanently'])
    expect(pick(s, 'Cancel').focus).toBe(true)
    expect(pick(s, 'Delete permanently').tone).toBe('danger')
  })

  it('counts several and shows the size when it is known', () => {
    const s = specOf(
      ArchiveDeleteDialog({
        names: ['a', 'b'],
        size: { state: 'known', bytes: 3 * 1024 * 1024 },
        onCancel: () => {},
        onDelete: () => {}
      })
    )
    expect(s.title).toBe('Delete 2 items permanently?')
    expect(s.text).toBe('3.0 MB')
  })
})
