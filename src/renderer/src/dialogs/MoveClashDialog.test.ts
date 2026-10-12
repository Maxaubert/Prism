import { describe, expect, it, vi } from 'vitest'
import { MoveClashDialog } from './MoveClashDialog'
import { labels, pick, specOf } from './testing'

const fns = (): { onCancel: () => void; onKeepBoth: () => void; onReplace: () => void } => ({
  onCancel: vi.fn(),
  onKeepBoth: vi.fn(),
  onReplace: vi.fn()
})

describe('MoveClashDialog', () => {
  it('names one clash, counts several', () => {
    expect(specOf(MoveClashDialog({ names: ['a.txt'], ...fns() })).title).toBe('"a.txt" is already there')
    expect(specOf(MoveClashDialog({ names: ['a.txt', 'b.txt'], ...fns() })).title).toBe(
      '2 names are already taken'
    )
    expect(specOf(MoveClashDialog({ names: ['a.txt'], ...fns() })).text).toBe(
      'Keep both lands them beside what is there; replacing sends the old ones to the Recycle Bin.'
    )
  })

  it('offers Cancel, Keep both (primary), Replace (red)', () => {
    const f = fns()
    const s = specOf(MoveClashDialog({ names: ['a.txt'], ...f }))
    expect(labels(s)).toEqual(['Cancel', 'Keep both', 'Replace'])
    expect(pick(s, 'Keep both').primary).toBe(true)
    expect(pick(s, 'Replace').danger).toBe(true)
    pick(s, 'Keep both').onPick()
    pick(s, 'Replace').onPick()
    expect(f.onKeepBoth).toHaveBeenCalledOnce()
    expect(f.onReplace).toHaveBeenCalledOnce()
  })
})
