import { describe, expect, it } from 'vitest'
import type { CellInfo } from './termCells'
import {
  isWebLink,
  osc8Target,
  Osc8Spans,
  parseOsc8,
  piecesOverlap,
  spanRows,
  spanText,
  spanTextRange,
  type Osc8Span
} from './termOsc8'

// Review 2026-10-11: xterm's OSC 8 provider outranks the web-links match on the
// visible text, so a label that READS as one address could open another.
describe('osc8Target', () => {
  it('opens the uri behind a label that is not an address', () => {
    expect(osc8Target('https://github.com/o/r/pull/165', null)).toBe('https://github.com/o/r/pull/165')
  })

  it('opens the uri when the label shows the same host', () => {
    expect(osc8Target('https://github.com/o/r/pull/165', 'https://github.com/o/r')).toBe(
      'https://github.com/o/r/pull/165'
    )
    expect(osc8Target('https://GitHub.com/x', 'https://github.com/y')).toBe('https://GitHub.com/x')
  })

  it('opens what the label SHOWS when it names another host', () => {
    expect(osc8Target('https://evil.example/', 'https://github.com/org/repo')).toBe('https://github.com/org/repo')
    expect(osc8Target('https://github.com:8443/', 'https://github.com/')).toBe('https://github.com/')
  })

  it('opens the label when the uri does not parse', () => {
    expect(osc8Target('https://', 'https://github.com/')).toBe('https://github.com/')
  })
})

const anchor = (line: number): { line: number; isDisposed: boolean; dispose(): void } => {
  const a = { line, isDisposed: false, dispose: () => (a.isDisposed = true) }
  return a
}

const span = (line: number, x: number, rows: number, endX: number, alt = false, text = 'label'): Osc8Span => ({
  anchor: anchor(line),
  x,
  rows,
  endX,
  uri: 'https://a.b/c',
  text,
  alt
})

const cells = (s: string): CellInfo[] => [...s].map((ch) => ({ chars: ch === ' ' ? '' : ch, width: 1 }))

describe('parseOsc8', () => {
  it('reads the uri after the params', () => {
    expect(parseOsc8('id=x;https://a.b/c')).toEqual({ uri: 'https://a.b/c' })
    expect(parseOsc8(';https://a.b/c')).toEqual({ uri: 'https://a.b/c' })
  })

  it('keeps a semicolon inside the uri', () => {
    expect(parseOsc8(';https://a.b/c?x=1;y=2')).toEqual({ uri: 'https://a.b/c?x=1;y=2' })
  })

  it('reads an empty uri as the close', () => {
    expect(parseOsc8(';')).toEqual({ uri: '' })
    expect(parseOsc8('id=x;')).toEqual({ uri: '' })
  })

  it('gives null for what is not OSC 8 at all', () => {
    expect(parseOsc8('garbage')).toBeNull()
    expect(parseOsc8('')).toBeNull()
  })
})

describe('isWebLink', () => {
  it('is http and https only', () => {
    expect(isWebLink('https://a.b')).toBe(true)
    expect(isWebLink('HTTP://a.b')).toBe(true)
    expect(isWebLink('file:///C:/x')).toBe(false)
    expect(isWebLink('javascript:alert(1)')).toBe(false)
    expect(isWebLink('ms-settings:display')).toBe(false)
  })
})

describe('Osc8Spans', () => {
  it('finds a span inside its cells and misses outside them', () => {
    const s = new Osc8Spans()
    s.add(span(5, 10, 0, 19))
    expect(s.at(5, 10, false)?.uri).toBe('https://a.b/c')
    expect(s.at(5, 18, false)).toBeDefined()
    expect(s.at(5, 19, false)).toBeUndefined() // the end is exclusive
    expect(s.at(5, 9, false)).toBeUndefined()
    expect(s.at(4, 12, false)).toBeUndefined()
    expect(s.at(5, 12, true)).toBeUndefined() // the other screen
  })

  it('follows a span over the rows it wraps onto', () => {
    const s = new Osc8Spans()
    s.add(span(5, 70, 1, 4))
    expect(s.at(5, 75, false)).toBeDefined()
    expect(s.at(6, 2, false)).toBeDefined()
    expect(s.at(6, 4, false)).toBeUndefined()
    expect(s.overlapping(6, 6, false)).toHaveLength(1)
    expect(s.overlapping(7, 9, false)).toHaveLength(0)
  })

  it('reads the line where its anchor is now, after the buffer trimmed', () => {
    const s = new Osc8Spans()
    const sp = span(500, 0, 0, 5)
    s.add(sp)
    ;(sp.anchor as { line: number }).line = 400
    expect(s.at(400, 2, false)).toBeDefined()
    expect(s.at(500, 2, false)).toBeUndefined()
  })

  it('forgets a span whose anchor is gone', () => {
    const s = new Osc8Spans()
    const sp = span(1, 0, 0, 5)
    s.add(sp)
    sp.anchor.dispose?.()
    expect(s.at(1, 2, false)).toBeUndefined()
    expect(s.overlapping(0, 10, false)).toHaveLength(0)
  })

  it('a newer span over the same cells replaces the older one', () => {
    // A TUI redraws its links in place; a ConPTY repaint re-sends them.
    const s = new Osc8Spans()
    const old = span(3, 2, 0, 9, true)
    s.add(old)
    s.add({ ...span(3, 5, 0, 12, true), uri: 'https://new/' })
    expect(s.at(3, 6, true)?.uri).toBe('https://new/')
    expect(s.at(3, 3, true)).toBeUndefined()
    expect(old.anchor.isDisposed).toBe(true)
  })

  it('keeps spans side by side that do not overlap', () => {
    const s = new Osc8Spans()
    s.add(span(3, 0, 0, 4, true))
    s.add(span(3, 4, 0, 8, true))
    expect(s.overlapping(3, 3, true)).toHaveLength(2)
  })

  it('holds its cap, dropping the oldest', () => {
    const s = new Osc8Spans(3)
    const first = span(0, 0, 0, 2)
    s.add(first)
    for (let i = 1; i <= 3; i += 1) s.add(span(i, 0, 0, 2))
    expect(s.at(0, 1, false)).toBeUndefined()
    expect(first.anchor.isDisposed).toBe(true)
    expect(s.at(3, 1, false)).toBeDefined()
  })

  it('clears one screen and leaves the other', () => {
    const s = new Osc8Spans()
    s.add(span(1, 0, 0, 2, true))
    s.add(span(1, 0, 0, 2, false))
    s.clear(true)
    expect(s.at(1, 1, true)).toBeUndefined()
    expect(s.at(1, 1, false)).toBeDefined()
    s.clear()
    expect(s.at(1, 1, false)).toBeUndefined()
  })
})

describe('spanRows', () => {
  it('cuts a span into one piece per row', () => {
    expect(spanRows(span(5, 70, 2, 4), 80)).toEqual([
      { line: 5, x: 70, width: 10 },
      { line: 6, x: 0, width: 80 },
      { line: 7, x: 0, width: 4 }
    ])
    expect(spanRows(span(2, 3, 0, 8), 80)).toEqual([{ line: 2, x: 3, width: 5 }])
  })

  it('gives nothing for an empty span', () => {
    expect(spanRows(span(2, 3, 0, 3), 80)).toEqual([])
  })
})

describe('spanText and spanTextRange', () => {
  it('reads the cells the span covers', () => {
    const rows: Record<number, CellInfo[]> = { 4: cells('see OSC8LABEL here') }
    expect(spanText(span(4, 4, 0, 13), 18, (l) => rows[l])).toBe('OSC8LABEL')
  })

  it('reads across a wrap', () => {
    const rows: Record<number, CellInfo[]> = { 0: cells('abcdeOSC'), 1: cells('8LABEL  ') }
    expect(spanText(span(0, 5, 1, 6), 8, (l) => rows[l])).toBe('OSC8LABEL')
  })

  it('gives null when a row is gone', () => {
    expect(spanText(span(0, 0, 0, 3), 8, () => undefined)).toBeNull()
  })

  it('counts a wide character as two cells and one character', () => {
    // "界" is one character in two cells: cells 0 and 1, the label from cell 3.
    const row: CellInfo[] = [
      { chars: '界', width: 2 },
      { chars: '', width: 0 },
      { chars: '', width: 1 },
      ...cells('PR #165')
    ]
    const sp = span(0, 3, 0, 10)
    expect(spanText(sp, row.length, () => row)).toBe('PR #165')
    // In the row's TEXT the label starts at 2 ("界" + " "), not at 3.
    expect(spanTextRange(row, 3, 10)).toEqual({ start: 2, end: 9 })
  })
})

// Review 2026-10-11: on the normal screen an OSC 8 link whose label is itself
// a URL was painted twice, once as the span and once as the URL the text
// matched; the alternate screen's ink already took it once.
describe('piecesOverlap', () => {
  const span = [
    { line: 4, x: 70, width: 10 },
    { line: 5, x: 0, width: 12 }
  ]
  it('is true for a match that shares a cell with a span, on any of its rows', () => {
    expect(piecesOverlap([{ line: 4, x: 70, width: 10 }], span)).toBe(true)
    expect(piecesOverlap([{ line: 5, x: 11, width: 4 }], span)).toBe(true)
  })
  it('is false beside it, on the same row or another', () => {
    expect(piecesOverlap([{ line: 4, x: 60, width: 10 }], span)).toBe(false)
    expect(piecesOverlap([{ line: 5, x: 12, width: 8 }], span)).toBe(false)
    expect(piecesOverlap([{ line: 6, x: 0, width: 12 }], span)).toBe(false)
    expect(piecesOverlap([{ line: 4, x: 70, width: 10 }], [])).toBe(false)
  })
})