import { describe, expect, it, vi } from 'vitest'
import { ArchiveClashDialog } from './ArchiveClashDialog'
import { labels, pick, specOf } from './testing'

describe('ArchiveClashDialog', () => {
  it('says nothing is written yet and offers Keep both', () => {
    const onKeepBoth = vi.fn()
    const s = specOf(ArchiveClashDialog({ names: ['a.txt'], onCancel: () => {}, onKeepBoth }))
    expect(s.title).toBe('"a.txt" is already in the archive')
    expect(s.text).toBe('Keep both adds them beside what is there. Nothing has been written yet.')
    expect(labels(s)).toEqual(['Cancel', 'Keep both'])
    expect(pick(s, 'Keep both').primary).toBe(true)
    pick(s, 'Keep both').onPick()
    expect(onKeepBoth).toHaveBeenCalledOnce()
  })

  it('counts several', () => {
    const s = specOf(ArchiveClashDialog({ names: ['a', 'b'], onCancel: () => {}, onKeepBoth: () => {} }))
    expect(s.title).toBe('2 names are already in the archive')
  })
})
