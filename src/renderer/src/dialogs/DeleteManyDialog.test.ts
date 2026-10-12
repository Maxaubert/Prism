import { describe, expect, it, vi } from 'vitest'
import { DeleteManyDialog } from './DeleteManyDialog'
import { labels, pick, specOf } from './testing'

describe('DeleteManyDialog', () => {
  it('counts the items', () => {
    const onDelete = vi.fn()
    const s = specOf(DeleteManyDialog({ count: 3, onCancel: () => {}, onDelete }))
    expect(s.title).toBe('Move 3 items to the Recycle Bin?')
    expect(s.text).toBe('Everything selected goes to the Recycle Bin, where Windows can put it back.')
    expect(labels(s)).toEqual(['Cancel', 'Delete'])
    expect(pick(s, 'Delete')).toMatchObject({ danger: true, primary: true })
    pick(s, 'Delete').onPick()
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
