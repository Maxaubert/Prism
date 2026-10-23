import { describe, expect, it } from 'vitest'
import { findLinks } from './termLinks'
import {
  bufferRowCells,
  cellFrom,
  cellText,
  charAtCell,
  logicalLine,
  type CellInfo,
  type CellLike
} from './termCells'

/** Cells for a string, the way xterm lays it out: a wide character is two. */
function cells(parts: Array<string | [string, 2]>, pad = 0): CellInfo[] {
  const out: CellInfo[] = []
  for (const p of parts) {
    if (Array.isArray(p)) out.push({ chars: p[0], width: 2 }, { chars: '', width: 0 })
    else for (const ch of Array.from(p)) out.push({ chars: ch, width: 1 })
  }
  for (let i = 0; i < pad; i += 1) out.push({ chars: '', width: 1 })
  return out
}

describe('cellText', () => {
  it('reads plain text with trailing blanks as spaces, and knows where the text ends', () => {
    const t = cellText(cells(['PS C:\\> '], 3))
    expect(t.text).toBe('PS C:\\>    ')
    // The space after the prompt is a CHARACTER the shell printed.
    expect(t.textEnd).toBe(8)
    expect(t.index[8]).toBe(8)
  })

  it('a wide character is two cells and one unit; its spacer maps to it', () => {
    const t = cellText(cells(['a', ['日', 2], 'b']))
    expect(t.text).toBe('a日b')
    expect(t.index).toEqual([0, 1, 1, 2, 3])
    expect(t.textEnd).toBe(4)
  })

  it('an emoji is two UTF-16 units in one cell pair, and a link after it keeps its edges', () => {
    const line = cells([['😀', 2], ' https://a.io/x more'])
    const t = cellText(line)
    const link = findLinks(t.text)[0]
    // The cell of the link's first 'h' and the cell right after its last 'x'.
    const firstH = 3
    const afterX = 3 + 'https://a.io/x'.length
    const on = (cell: number): boolean => t.index[cell] >= link.start && t.index[cell] < link.end
    expect(on(firstH)).toBe(true)
    expect(on(afterX - 1)).toBe(true)
    expect(on(afterX)).toBe(false)
  })
})

describe('cellFrom', () => {
  it('walks back over wrapped rows', () => {
    expect(cellFrom(5, 2, 4, 10)).toEqual({ row: 4, col: 8 })
  })
  it('a cursor past the text (after a trailing space) moves right, wrapping', () => {
    expect(cellFrom(5, 9, -1, 10)).toEqual({ row: 6, col: 0 })
    expect(cellFrom(5, 7, -1, 10)).toEqual({ row: 5, col: 8 })
  })
  it('never walks above the first row', () => {
    expect(cellFrom(0, 1, 5, 10)).toEqual({ row: 0, col: 0 })
  })
})

// The buffer readers moved here from TerminalPanel (audit 2026-10-12), on
// plain objects: a line of `cols` cells, wrapped onto the next row.
describe('logicalLine and charAtCell', () => {
  const row = (text: string, wrapped: boolean) => ({
    isWrapped: wrapped,
    getCell: (x: number) => {
      const ch = x < text.length ? text[x] : ''
      return { getChars: () => ch, getWidth: () => 1 }
    }
  })
  const buf = (rows: Array<[string, boolean]>) => ({
    length: rows.length,
    getLine: (y: number) => (rows[y] ? row(rows[y][0], rows[y][1]) : undefined)
  })
  it('joins a wrapped line from any of its rows', () => {
    const b = buf([['$ ls', false], ['abcd', false], ['efgh', true], ['ij', true], ['next', false]])
    for (const y of [1, 2, 3]) {
      const l = logicalLine(b, 4, y)
      expect([l.first, l.last]).toEqual([1, 3])
      expect(l.text).toBe('abcdefghij  ')
      expect(l.textEnd).toBe(10)
    }
  })
  it('turns a cell into its place in the text, clamped to the line', () => {
    const b = buf([['abcd', false], ['ef', true]])
    const l = logicalLine(b, 4, 0)
    expect(charAtCell(l, 4, 1, 1)).toBe(5)
    expect(charAtCell(l, 4, 0, -3)).toBe(0)
    expect(charAtCell(l, 4, 9, 9)).toBe(l.text.length)
  })
})

describe('reading a row into cells (perf review 2026-10-16)', () => {
  it('loads every cell into the one scratch cell it is given, copying each out', () => {
    const text = 'ab'
    const seen: Array<CellLike | undefined> = []
    const line = {
      getCell: (x: number, into?: CellLike): CellLike => {
        seen.push(into)
        return { getChars: () => text[x] ?? '', getWidth: () => 1 }
      }
    }
    const scratch: CellLike = { getChars: () => '', getWidth: () => 1 }
    expect(bufferRowCells(line, 3, scratch)).toEqual([
      { chars: 'a', width: 1 },
      { chars: 'b', width: 1 },
      { chars: '', width: 1 }
    ])
    expect(seen).toHaveLength(3)
    expect(seen.every((c) => c === scratch)).toBe(true)
  })
})
