import { describe, expect, it, vi } from 'vitest'
import { PermanentDeleteDialog } from './PermanentDeleteDialog'
import { labels, pick, specOf } from './testing'

describe('PermanentDeleteDialog (owner, 2026-11-10, #500)', () => {
  it('one item: "Delete <name> permanently?" and the size', () => {
    const s = specOf(
      PermanentDeleteDialog({
        names: ['a.txt'],
        size: { state: 'known', bytes: 2048 },
        onCancel: () => {},
        onDelete: () => {}
      })
    )
    expect(s.title).toBe('Delete a.txt permanently?')
    expect(s.text).toBe('2.0 KB')
  })

  it('several: counts them', () => {
    const s = specOf(
      PermanentDeleteDialog({ names: ['a', 'b', 'c'], onCancel: () => {}, onDelete: () => {} })
    )
    expect(s.title).toBe('Delete 3 items permanently?')
    expect(s.text).toBe('…')
  })

  it('names more than it lists: the count wins', () => {
    const s = specOf(
      PermanentDeleteDialog({ names: ['a', 'b'], count: 40, onCancel: () => {}, onDelete: () => {} })
    )
    expect(s.title).toBe('Delete 40 items permanently?')
  })

  it('is final: Cancel has the focus, Delete permanently is the red one, no middle button', () => {
    const onCancel = vi.fn()
    const onDelete = vi.fn()
    const s = specOf(PermanentDeleteDialog({ names: ['a.txt'], onCancel, onDelete }))
    expect(labels(s)).toEqual(['Cancel', 'Delete permanently'])
    expect(pick(s, 'Cancel')).toMatchObject({ tone: 'plain', focus: true })
    expect(pick(s, 'Delete permanently').tone).toBe('danger')
    expect(pick(s, 'Delete permanently').focus).toBeFalsy()
    pick(s, 'Delete permanently').onPick()
    pick(s, 'Cancel').onPick()
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('uses the warning icon', () => {
    expect(
      PermanentDeleteDialog({ names: ['a'], onCancel: () => {}, onDelete: () => {} }).props.icon
    ).toBe('warn')
  })
})
