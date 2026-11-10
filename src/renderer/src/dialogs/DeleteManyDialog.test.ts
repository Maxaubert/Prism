import { describe, expect, it } from 'vitest'
import { DeleteManyDialog } from './DeleteManyDialog'
import { labels, pick, specOf } from './testing'

const go = { onCancel: () => {}, onDelete: () => {}, onPermanent: () => {} }

describe('DeleteManyDialog (several items to the Recycle Bin; owner, 2026-11-10, #500)', () => {
  it('asks "Delete N items?" with the first two names, the rest and the total', () => {
    const s = specOf(
      DeleteManyDialog({
        names: ['a.heic', 'b.mov', 'c', 'd'],
        count: 12,
        size: { state: 'known', bytes: 1.4 * 1024 ** 3 },
        ...go
      })
    )
    expect(s.title).toBe('Delete 12 items?')
    expect(s.text).toBe('a.heic, b.mov +10 · 1.4 GB')
  })

  it('names both of two items without a "+" when none are left over', () => {
    expect(
      specOf(DeleteManyDialog({ names: ['a', 'b'], count: 2, size: { state: 'counting' }, ...go })).text
    ).toBe('a, b · …')
  })

  it('has the same three buttons as one item, Delete the default', () => {
    const s = specOf(DeleteManyDialog({ names: ['a', 'b', 'c'], count: 3, ...go }))
    expect(s.title).toBe('Delete 3 items?')
    expect(labels(s)).toEqual(['Cancel', 'Delete permanently', 'Delete'])
    expect(pick(s, 'Delete')).toMatchObject({ tone: 'danger', focus: true })
    expect(pick(s, 'Delete permanently').tone).toBe('outline')
  })
})
