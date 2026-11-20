import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FindBar } from './FindBar'
import { findKey, findStatus } from '../lib/findBarKeys'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// One find bar for the PDF and the other documents (#524), in DocFind's words.
const key = (k: string, shiftKey = false) => ({
  key: k,
  shiftKey,
  stopPropagation: vi.fn(),
  preventDefault: vi.fn()
})

describe('the find bar words', () => {
  it('counts "2 of 5", says "none", and is empty with no query', () => {
    expect(findStatus('grape', 5, 1)).toBe('2 of 5')
    expect(findStatus('grape', 0, -1)).toBe('none')
    expect(findStatus('', 0, -1)).toBe('')
  })

  it('says "Find" in the field and keeps the screen reader label', () => {
    const html = renderToStaticMarkup(
      createElement(FindBar, { query: '', onQuery: () => {}, count: 0, at: -1, onStep: () => {}, onClose: () => {} })
    )
    expect(html).toContain('placeholder="Find"')
    expect(html).toContain('aria-label="Find in document"')
    expect(html).toContain('data-owns-escape')
    expect(html).not.toContain('rounded-full')
  })
})

describe('the find bar keys', () => {
  it('every key stops before the app shortcuts, a letter too (the PDF bar let it through)', () => {
    for (const k of ['a', 'f', ' ', 'ArrowDown', 'Enter', 'Escape', 'PageDown']) {
      const e = key(k)
      findKey(e, () => {}, () => {})
      expect(e.stopPropagation, k).toHaveBeenCalled()
    }
  })

  it('Enter and F3 step, Shift reverses, Escape closes', () => {
    const step = vi.fn()
    const close = vi.fn()
    findKey(key('Enter'), step, close)
    findKey(key('F3', true), step, close)
    expect(step.mock.calls).toEqual([[1], [-1]])
    findKey(key('Escape'), step, close)
    expect(close).toHaveBeenCalledTimes(1)
    findKey(key('x'), step, close)
    expect(step).toHaveBeenCalledTimes(2)
  })

  it('the PDF and DocFind both draw it, and PdfFindBar is gone', () => {
    const src = (p: string): string => readFileSync(join(__dirname, p), 'utf8')
    expect(src('pdf/PdfView.tsx')).toMatch(/<FindBar/)
    expect(src('DocFind.tsx')).toMatch(/<FindBar/)
    expect(() => src('pdf/PdfFindBar.tsx')).toThrow()
  })
})