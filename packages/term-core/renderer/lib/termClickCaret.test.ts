import { describe, expect, it } from 'vitest'
import { arrowKeys, caretClickAllowed, caretDelta, type ClickGate } from './termClickCaret'

const plain: ClickGate = {
  button: 0,
  detail: 1,
  modifiers: false,
  dragged: false,
  mouseTracking: 'none',
  alternate: false,
  scrolledBack: false,
  cursorHidden: false,
  textBelow: false,
  offLine: false,
  onLink: false
}

describe('caretClickAllowed', () => {
  it('lets a plain click on the prompt line through', () => {
    expect(caretClickAllowed(plain)).toBe(true)
  })
  it.each([
    ['a right click', { button: 2 }],
    ['a double click', { detail: 2 }],
    ['a modified click', { modifiers: true }],
    ['a drag or selection', { dragged: true }],
    ['a program that owns the mouse', { mouseTracking: 'vt200' as const }],
    ["a full-screen program's screen", { alternate: true }],
    ['a view scrolled back', { scrolledBack: true }],
    ['a hidden cursor', { cursorHidden: true }],
    ['a program printing below the line', { textBelow: true }],
    ['a click off the line', { offLine: true }],
    ['a click on a link', { onLink: true }]
  ])('refuses %s', (_name, patch) => {
    expect(caretClickAllowed({ ...plain, ...patch })).toBe(false)
  })
})

describe('caretDelta', () => {
  const ones = (n: number): number[] => Array.from({ length: n }, () => 1)
  it('counts characters to the right and to the left', () => {
    expect(caretDelta(ones(20), 12, 5, 12)).toBe(-7)
    expect(caretDelta(ones(20), 5, 9, 12)).toBe(4)
    expect(caretDelta(ones(20), 5, 5, 12)).toBe(0)
  })
  it('counts a wide character once, and a click on its second half lands on it', () => {
    // a 中 b : cells 1, 2, 0, 1
    const w = [1, 2, 0, 1]
    expect(caretDelta(w, 4, 0, 4)).toBe(-3)
    expect(caretDelta(w, 4, 2, 4)).toBe(-2)
    expect(caretDelta(w, 0, 3, 4)).toBe(2)
  })
  it('crosses the wraps of one logical line', () => {
    // two rows of 10 cells, cursor at the end of the text on row two
    expect(caretDelta(ones(20), 15, 3, 15)).toBe(-12)
  })
  it('treats a click past the text as the end of it', () => {
    expect(caretDelta(ones(80), 3, 70, 10)).toBe(7)
    // a trailing space typed puts the cursor past the last printed cell
    expect(caretDelta(ones(80), 11, 70, 10)).toBe(0)
  })
})

describe('arrowKeys', () => {
  it('sends Right and Left, in the application form when asked', () => {
    expect(arrowKeys(3, false)).toBe('\x1b[C\x1b[C\x1b[C')
    expect(arrowKeys(-2, false)).toBe('\x1b[D\x1b[D')
    expect(arrowKeys(1, true)).toBe('\x1bOC')
    expect(arrowKeys(0, false)).toBe('')
  })
})
