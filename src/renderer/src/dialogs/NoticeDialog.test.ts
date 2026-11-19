import { describe, expect, it, vi } from 'vitest'
import { NoticeDialog } from './NoticeDialog'
import { labels, pick, specOf } from './testing'

describe('NoticeDialog', () => {
  it('says the message with one Close', () => {
    const onClose = vi.fn()
    const s = specOf(NoticeDialog({ title: "That didn't work", message: 'Nope.', onClose }))
    expect(s.title).toBe("That didn't work")
    expect(s.text).toBe('Nope.')
    expect(labels(s)).toEqual(['Close'])
    expect(pick(s, 'Close').primary).toBe(true)
    pick(s, 'Close').onPick()
    s.onCancel()
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('has no OK option any more (#520)', () => {
    const s = specOf(NoticeDialog({ title: 'Paste', message: 'x', button: 'OK', onClose: () => {} } as never))
    expect(labels(s)).toEqual(['Close'])
  })
})
