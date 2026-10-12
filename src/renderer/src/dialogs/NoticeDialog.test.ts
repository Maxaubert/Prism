import { describe, expect, it, vi } from 'vitest'
import { NoticeDialog } from './NoticeDialog'
import { labels, pick, specOf } from './testing'

describe('NoticeDialog', () => {
  it('says the message with one OK by default', () => {
    const onClose = vi.fn()
    const s = specOf(NoticeDialog({ title: "That didn't work", message: 'Nope.', onClose }))
    expect(s.title).toBe("That didn't work")
    expect(s.text).toBe('Nope.')
    expect(labels(s)).toEqual(['OK'])
    pick(s, 'OK').onPick()
    s.onCancel()
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('can say Close instead', () => {
    const s = specOf(NoticeDialog({ title: 'Paste', message: 'x', button: 'Close', onClose: () => {} }))
    expect(labels(s)).toEqual(['Close'])
    expect(pick(s, 'Close').primary).toBe(true)
  })
})
