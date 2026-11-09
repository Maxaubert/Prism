import { describe, expect, it } from 'vitest'
import { gridKey, gridStep, type GridDir } from './gridNav'

// 11 items in 4 columns: lines of 4, 4, 3 (the last line is short).
const N = 11
const C = 4
const step = (from: number, to: GridDir, lines = 3): number | null =>
  gridStep(N, C, from, to, lines)

describe('gridStep', () => {
  it('moves one sideways and stops at the first and last item (no wrap)', () => {
    expect(step(5, 'left')).toBe(4)
    expect(step(5, 'right')).toBe(6)
    expect(step(0, 'left')).toBe(0)
    expect(step(3, 'right')).toBe(4) // a line's end continues on the next line's start
    expect(step(10, 'right')).toBe(10)
  })
  it('moves a whole line up and down, and stays on the first and last lines', () => {
    expect(step(5, 'up')).toBe(1)
    expect(step(5, 'down')).toBe(9)
    expect(step(2, 'up')).toBe(2)
    expect(step(9, 'down')).toBe(9) // already in the last line
    expect(step(10, 'down')).toBe(10)
  })
  it('Down from the line above a short last line lands on the last item', () => {
    expect(step(7, 'down')).toBe(10) // 7 + 4 is past the end, 7 is not in the last line
    expect(step(6, 'down')).toBe(10)
    expect(step(4, 'down')).toBe(8)
  })
  it('has Home and End', () => {
    expect(step(6, 'home')).toBe(0)
    expect(step(6, 'end')).toBe(10)
  })
  it('pages by the visible lines less one, clamped', () => {
    expect(gridStep(100, 4, 0, 'pagedown', 5)).toBe(16)
    expect(gridStep(100, 4, 50, 'pageup', 5)).toBe(34)
    expect(gridStep(100, 4, 2, 'pageup', 5)).toBe(0)
    expect(gridStep(100, 4, 98, 'pagedown', 5)).toBe(99)
    expect(gridStep(100, 4, 0, 'pagedown', 1)).toBe(4) // always at least one line
  })
  it('with nothing focused, Down and Right land on the first, Up and Left on the last', () => {
    expect(step(-1, 'down')).toBe(0)
    expect(step(-1, 'right')).toBe(0)
    expect(step(-1, 'up')).toBe(10)
    expect(step(-1, 'left')).toBe(10)
    expect(step(-1, 'pagedown')).toBe(0)
    expect(step(-1, 'pageup')).toBe(10)
  })
  it('answers null for an empty folder and works with one column', () => {
    expect(gridStep(0, 4, -1, 'down', 3)).toBeNull()
    expect(gridStep(5, 1, 2, 'down', 3)).toBe(3)
    expect(gridStep(5, 1, 2, 'right', 3)).toBe(3)
  })
})

const key = (
  k: string,
  mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}
) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods })

describe('gridKey', () => {
  it('plain arrows move; Shift extends the marks over the index range; Ctrl moves the focus only', () => {
    expect(gridKey(key('ArrowDown'), true)).toEqual({ to: 'down', mode: 'move' })
    expect(gridKey(key('ArrowDown', { shiftKey: true }), true)).toEqual({ to: 'down', mode: 'extend' })
    expect(gridKey(key('ArrowRight', { ctrlKey: true }), true)).toEqual({ to: 'right', mode: 'focus' })
    expect(gridKey(key('PageDown'), true)).toEqual({ to: 'pagedown', mode: 'move' })
    expect(gridKey(key('End', { shiftKey: true }), true)).toEqual({ to: 'end', mode: 'extend' })
  })
  it("Left and Right are the grid's only; in the list they fall through to the viewer", () => {
    expect(gridKey(key('ArrowLeft'), false)).toBeNull()
    expect(gridKey(key('ArrowRight', { shiftKey: true }), false)).toBeNull()
    expect(gridKey(key('ArrowLeft'), true)).toEqual({ to: 'left', mode: 'move' })
  })
  it('leaves Alt chords (history, parent), Ctrl+Shift, Meta and other keys alone', () => {
    expect(gridKey(key('ArrowLeft', { altKey: true }), true)).toBeNull()
    expect(gridKey(key('ArrowUp', { altKey: true }), true)).toBeNull()
    expect(gridKey(key('ArrowUp', { ctrlKey: true, shiftKey: true }), true)).toBeNull()
    expect(gridKey(key('ArrowUp', { metaKey: true }), true)).toBeNull()
    expect(gridKey(key('a'), true)).toBeNull()
    expect(gridKey(key(' '), true)).toBeNull()
    expect(gridKey(key('Enter'), true)).toBeNull()
  })
})
