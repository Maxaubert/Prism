import { describe, expect, it } from 'vitest'
import { isJumpKey, listKey, spaceKey, typeJump, typedRun } from './listKeys'
import { gridKey } from './gridNav'

// The keys the grid shares with the list are the list's own, untouched
// (spec 5.2, 5.3): the grid adds Left and Right and nothing else.
const k = (
  key: string,
  m: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}
) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...m })

describe('the grid and the list share one key model', () => {
  it('Ctrl+Space still toggles the mark and Ctrl+A still selects all', () => {
    expect(listKey(k(' ', { ctrlKey: true }))).toBe('toggle-mark')
    expect(listKey(k('a', { ctrlKey: true }))).toBe('select-all')
  })
  it('listKey knows no Left or Right chord but Alt (history)', () => {
    expect(listKey(k('ArrowLeft'))).toBeNull()
    expect(listKey(k('ArrowRight', { shiftKey: true }))).toBeNull()
    expect(listKey(k('ArrowLeft', { ctrlKey: true }))).toBeNull()
    expect(listKey(k('ArrowLeft', { altKey: true }))).toBe('back')
  })
  it('where both name a key, the grid takes it first and agrees on the mode', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End']) {
      for (const m of [{}, { shiftKey: true }, { ctrlKey: true }]) {
        const g = gridKey(k(key, m), true)
        expect(g).not.toBeNull()
        const l = listKey(k(key, m))
        if (l) expect(l.startsWith(g!.mode === 'extend' ? 'extend' : 'focus')).toBe(true)
      }
    }
  })
  it("type-ahead and Space are the list's, by name and by clock", () => {
    expect(typeJump(['alpha', 'photo1', 'phone'], 0, 'ph')).toBe(1)
    expect(isJumpKey('p')).toBe(true)
    expect(typedRun({ text: 'p', at: 100 }, 'H', 200).text).toBe('ph')
    expect(spaceKey(k(' '), { text: '', at: 0 }, 5000)).toBe('preview')
    expect(spaceKey(k(' '), { text: 'p', at: 4900 }, 5000)).toBe('type')
  })
})
