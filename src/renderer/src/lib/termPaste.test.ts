import { describe, expect, it } from 'vitest'
import { decidePaste, quotePaths } from './termPaste'

describe('decidePaste', () => {
  // Image wins: a clipboard-aware TUI (Claude Code) reads it itself off the
  // OS clipboard when it sees the ^V keystroke; our job is not to swallow it.
  it('an image forwards the ^V key', () => {
    expect(decidePaste({ image: true, text: '', files: [] })).toEqual({ kind: 'key' })
  })
  it('an image wins even when text rides along (Word copies both)', () => {
    expect(decidePaste({ image: true, text: 'x', files: [] })).toEqual({ kind: 'key' })
  })
  it('text becomes a bracketed paste', () => {
    expect(decidePaste({ image: false, text: 'a\\nb', files: [] })).toEqual({ kind: 'text', data: 'a\\nb' })
  })
  it('copied files paste as quoted paths', () => {
    expect(decidePaste({ image: false, text: '', files: ['C:\\a b\\s.png'] })).toEqual({
      kind: 'text',
      data: '"C:\\a b\\s.png"'
    })
  })
  it('copied files beat their own text form (Explorer sets both)', () => {
    expect(decidePaste({ image: false, text: 's.png', files: ['C:\\x\\s.png'] })).toEqual({
      kind: 'text',
      data: '"C:\\x\\s.png"'
    })
  })
  it('an empty clipboard does nothing', () => {
    expect(decidePaste({ image: false, text: '', files: [] })).toEqual({ kind: 'none' })
  })
})

describe('quotePaths', () => {
  it('quotes each and joins with spaces', () => {
    expect(quotePaths(['C:\\a.png', 'C:\\b c.png'])).toBe('"C:\\a.png" "C:\\b c.png"')
  })
})
