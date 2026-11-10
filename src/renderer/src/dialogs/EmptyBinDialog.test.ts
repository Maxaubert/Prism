import { describe, expect, it, vi } from 'vitest'
import { EmptyBinDialog } from './EmptyBinDialog'
import { labels, pick, specOf } from './testing'

describe('EmptyBinDialog (Recycle Bin, D15)', () => {
  it('says everything on every drive goes for good', () => {
    const s = specOf(EmptyBinDialog({ onCancel: () => {}, onEmpty: () => {} }))
    expect(s.title).toBe('Empty the Recycle Bin?')
    expect(s.text).toBe(
      'Everything in it, on every drive, is deleted for good. Windows cannot put it back.'
    )
  })

  it('adds the count when the bin is open and shows it', () => {
    const s = specOf(EmptyBinDialog({ count: 10000, onCancel: () => {}, onEmpty: () => {} }))
    expect(s.text).toBe(
      'Everything in it (10,000 items), on every drive, is deleted for good. Windows cannot put it back.'
    )
    expect(
      specOf(EmptyBinDialog({ count: 1, onCancel: () => {}, onEmpty: () => {} })).text
    ).toContain('(1 item)')
  })

  it('Cancel is the primary and Empty the danger', () => {
    const onEmpty = vi.fn()
    const s = specOf(EmptyBinDialog({ onCancel: () => {}, onEmpty }))
    expect(labels(s)).toEqual(['Cancel', 'Empty'])
    expect(pick(s, 'Cancel').primary).toBe(true)
    expect(pick(s, 'Empty').danger).toBe(true)
    expect(pick(s, 'Empty').primary).toBeFalsy()
    pick(s, 'Empty').onPick()
    expect(onEmpty).toHaveBeenCalledOnce()
  })
})
