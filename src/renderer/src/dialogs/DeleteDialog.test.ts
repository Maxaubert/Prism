import { describe, expect, it, vi } from 'vitest'
import { DeleteDialog } from './DeleteDialog'
import { labels, pick, specOf } from './testing'

describe('DeleteDialog', () => {
  it('names the item and says Windows can put it back', () => {
    const s = specOf(DeleteDialog({ name: 'a.txt', onCancel: () => {}, onDelete: () => {} }))
    expect(s.title).toBe('Move to the Recycle Bin?')
    expect(s.text).toBe('a.txt goes to the Recycle Bin, where Windows can put it back.')
  })

  it('offers Cancel, then Delete as the red primary', () => {
    const onCancel = vi.fn()
    const onDelete = vi.fn()
    const s = specOf(DeleteDialog({ name: 'a.txt', onCancel, onDelete }))
    expect(labels(s)).toEqual(['Cancel', 'Delete'])
    expect(pick(s, 'Delete')).toMatchObject({ danger: true, primary: true })
    pick(s, 'Delete').onPick()
    pick(s, 'Cancel').onPick()
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
