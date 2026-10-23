import { describe, expect, it } from 'vitest'
import { linkAt, selectionDeleteAllowed, selectionDeleteKeys, type SelectionGate } from './termSelectionEdit'

const plain: SelectionGate = {
  mouseTracking: 'none',
  alternate: false,
  scrolledBack: false,
  cursorHidden: false,
  textBelow: false,
  onLine: true
}
const cells = (n: number): number[] => Array(n).fill(1)
const L = '\x1b[D'
const R = '\x1b[C'
const BS = '\x7f'

describe('selectionDeleteAllowed', () => {
  it('allows a selection on the line being edited at a quiet prompt', () => {
    expect(selectionDeleteAllowed(plain)).toBe(true)
  })

  it('refuses every case where the line is not ours to edit', () => {
    expect(selectionDeleteAllowed({ ...plain, onLine: false })).toBe(false)
    expect(selectionDeleteAllowed({ ...plain, alternate: true })).toBe(false)
    expect(selectionDeleteAllowed({ ...plain, scrolledBack: true })).toBe(false)
    expect(selectionDeleteAllowed({ ...plain, cursorHidden: true })).toBe(false)
    expect(selectionDeleteAllowed({ ...plain, textBelow: true })).toBe(false)
    expect(selectionDeleteAllowed({ ...plain, mouseTracking: 'vt200' })).toBe(false)
  })
})

describe('selectionDeleteKeys', () => {
  // "PS> echo hello world", cursor at the end (cell 20).
  const line = cells(40)
  it('deletes a word at the end with Backspaces only', () => {
    expect(selectionDeleteKeys(line, 20, 15, 20, 20, false)).toBe(BS.repeat(5))
  })

  it('walks to the end of a selection in the middle first', () => {
    // "hello" is cells 10-15, the cursor is 5 to its right.
    expect(selectionDeleteKeys(line, 20, 10, 15, 20, false)).toBe(L.repeat(5) + BS.repeat(5))
  })

  it('walks right when the cursor is before the selection', () => {
    expect(selectionDeleteKeys(line, 4, 10, 15, 20, false)).toBe(R.repeat(11) + BS.repeat(5))
  })

  it('takes a selection made backwards the same way', () => {
    expect(selectionDeleteKeys(line, 20, 15, 10, 20, false)).toBe(L.repeat(5) + BS.repeat(5))
  })

  it('stops at the end of the text: trailing blank cells delete nothing', () => {
    expect(selectionDeleteKeys(line, 20, 15, 35, 20, false)).toBe(BS.repeat(5))
    expect(selectionDeleteKeys(line, 20, 25, 35, 20, false)).toBe('')
  })

  it('counts a wide character once', () => {
    // "ab" then a wide character (2 cells, the second 0) then "c"; cursor at the end.
    const wide = [1, 1, 2, 0, 1]
    expect(selectionDeleteKeys(wide, 5, 2, 4, 5, false)).toBe(L + BS)
  })

  it('uses the application cursor form when the program asked for it', () => {
    expect(selectionDeleteKeys(line, 20, 10, 15, 20, true)).toBe('\x1bOD'.repeat(5) + BS.repeat(5))
  })
})

describe('linkAt', () => {
  const text = 'see https://example.com/docs. then'
  it('names the link under the character', () => {
    expect(linkAt(text, 4)).toBe('https://example.com/docs')
    expect(linkAt(text, 27)).toBe('https://example.com/docs')
  })

  it('is null off the link, including its sentence full stop', () => {
    expect(linkAt(text, 2)).toBeNull()
    expect(linkAt(text, 28)).toBeNull()
  })
})
