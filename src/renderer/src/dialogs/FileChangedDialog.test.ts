import { describe, expect, it, vi } from 'vitest'
import { FileChangedDialog } from './FileChangedDialog'
import { labels, pick, specOf } from './testing'

describe('FileChangedDialog', () => {
  it('says there is no merge, and a dismiss keeps mine', () => {
    const onKeep = vi.fn()
    const onReload = vi.fn()
    const s = specOf(FileChangedDialog({ name: 'notes.txt', onKeep, onReload }))
    expect(s.title).toBe('This file changed on disk')
    expect(s.text).toBe(
      'Something outside Prism rewrote notes.txt while you have unsaved changes in it. There is no merge: it is your version or the one on disk.'
    )
    expect(labels(s)).toEqual(['Keep mine', 'Reload from disk'])
    expect(pick(s, 'Reload from disk').danger).toBe(true)
    s.onCancel()
    expect(onKeep).toHaveBeenCalledOnce()
    pick(s, 'Reload from disk').onPick()
    expect(onReload).toHaveBeenCalledOnce()
  })
})
