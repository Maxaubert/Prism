import { describe, expect, it, vi } from 'vitest'
import { ArchiveFactsDialog } from './ArchiveFactsDialog'
import { labels, pick, specOf } from './testing'

describe('ArchiveFactsDialog', () => {
  it('titles with the name and lists the facts in order', () => {
    const onClose = vi.fn()
    const s = specOf(
      ArchiveFactsDialog({
        name: 'a.txt',
        lines: [
          ['Size', '1 KB'],
          ['Packed', '200 B']
        ],
        onClose
      })
    )
    expect(s.title).toBe('a.txt')
    expect(s.text).toBe('Size1 KBPacked200 B')
    expect(labels(s)).toEqual(['OK'])
    pick(s, 'OK').onPick()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
