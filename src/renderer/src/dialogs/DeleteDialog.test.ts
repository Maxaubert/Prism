import { describe, expect, it, vi } from 'vitest'
import { DeleteDialog } from './DeleteDialog'
import { labels, pick, specOf } from './testing'

const props = { name: 'a.txt', onCancel: () => {}, onDelete: () => {}, onPermanent: () => {} }

describe('DeleteDialog (one item to the Recycle Bin; owner, 2026-11-10, #500)', () => {
  it('asks "Delete <name>?" and says only the size', () => {
    const s = specOf(DeleteDialog({ ...props, size: { state: 'known', bytes: 4.2 * 1024 * 1024 } }))
    expect(s.title).toBe('Delete a.txt?')
    expect(s.text).toBe('4.2 MB')
  })

  it('shows a quiet ellipsis until a folder is counted', () => {
    expect(specOf(DeleteDialog({ ...props, size: { state: 'counting' } })).text).toBe('…')
    expect(specOf(DeleteDialog({ ...props })).text).toBe('…')
  })

  it('says nothing of the size when it cannot be known', () => {
    expect(specOf(DeleteDialog({ ...props, size: { state: 'none' } })).text).toBe('')
  })

  it('offers Cancel, Delete permanently (outline) and Delete (red, the default)', () => {
    const onCancel = vi.fn()
    const onDelete = vi.fn()
    const onPermanent = vi.fn()
    const s = specOf(DeleteDialog({ ...props, onCancel, onDelete, onPermanent }))
    expect(labels(s)).toEqual(['Cancel', 'Delete permanently', 'Delete'])
    expect(pick(s, 'Cancel').tone).toBe('plain')
    expect(pick(s, 'Delete permanently').tone).toBe('outline')
    expect(pick(s, 'Delete').tone).toBe('danger')
    expect(pick(s, 'Delete').focus).toBe(true)
    expect(pick(s, 'Cancel').focus).toBeFalsy()
    pick(s, 'Delete').onPick()
    pick(s, 'Cancel').onPick()
    pick(s, 'Delete permanently').onPick()
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onPermanent).toHaveBeenCalledOnce()
  })

  it('uses the trash icon', () => {
    expect(DeleteDialog(props).props.icon).toBe('trash')
  })
})
