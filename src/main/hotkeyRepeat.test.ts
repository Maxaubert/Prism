import { describe, expect, it } from 'vitest'
import { REPEAT_MS, repeatOf, type HotkeyOpening } from './hotkeyRepeat'

const opening = (over: Partial<HotkeyOpening> = {}): HotkeyOpening => ({ id: 'x', browse: null, ackedAt: null, closed: false, ...over })

describe('repeat Win+E presses (owner, 2026-11-06: four presses opened four windows)', () => {
  it('while the window is opening, a press follows it', () => {
    expect(repeatOf(opening(), null, 5)).toBe('follow')
  })
  it('for a second after it showed its folder, a press raises it; after that, a press opens a window', () => {
    expect(repeatOf(opening({ ackedAt: 1000 }), null, 1000 + REPEAT_MS)).toBe('raise')
    expect(repeatOf(opening({ ackedAt: 1000 }), null, 1001 + REPEAT_MS)).toBeNull()
  })
  it('a different folder, a closed window or nothing opening opens its own', () => {
    expect(repeatOf(opening({ browse: 'C:\\a' }), 'C:\\b', 5)).toBeNull()
    expect(repeatOf(opening({ browse: 'C:\\A' }), 'c:\\a', 5)).toBe('follow')
    expect(repeatOf(opening({ closed: true }), null, 5)).toBeNull()
    expect(repeatOf(null, null, 5)).toBeNull()
  })
})
