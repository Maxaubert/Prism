import { describe, expect, it } from 'vitest'
import { clampPage, hexRows, offsetLabel, PAGE_BYTES, pageCount, pageRange } from './hexRows'

const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n)

describe('the rows', () => {
  it('lays bytes out sixteen to a row', () => {
    const rows = hexRows(Uint8Array.from({ length: 33 }, (_, i) => i), 0)
    expect(rows).toHaveLength(3)
    expect(rows[0].offset).toBe(0)
    expect(rows[1].offset).toBe(16)
    expect(rows[2].offset).toBe(32)
    expect(rows[0].cells[0]).toBe('00')
    expect(rows[0].cells[15]).toBe('0f')
  })

  it('counts offsets from where the page starts in the FILE', () => {
    expect(hexRows(bytes(1, 2, 3), 4096)[0].offset).toBe(4096)
  })

  it('keeps the columns on a short last row, rather than a ragged edge', () => {
    const rows = hexRows(bytes(0xde, 0xad), 0)
    expect(rows[0].cells).toHaveLength(16)
    expect(rows[0].cells[0]).toBe('de')
    expect(rows[0].cells[2]).toBe('')
    expect(rows[0].ascii).toBe('..')
  })

  it('shows printable ASCII and nothing else', () => {
    // 0x00 is not text, 0x7f is delete, and 0xe9 is a BYTE - calling it "é"
    // would be a guess about an encoding a dump has no business making.
    expect(hexRows(bytes(0x48, 0x69, 0x00, 0x7f, 0xe9, 0x20), 0)[0].ascii).toBe('Hi... ')
  })

  it('has no rows for no bytes', () => {
    expect(hexRows(new Uint8Array(0), 0)).toEqual([])
  })
})

describe('the offset column', () => {
  it('is eight digits for an ordinary file', () => {
    expect(offsetLabel(0, 1000)).toBe('00000000')
    expect(offsetLabel(4096, 1_000_000)).toBe('00001000')
  })

  it('widens past 4GB rather than wrapping part way down', () => {
    expect(offsetLabel(0, 0x1_0000_0000 + 1)).toBe('0000000000')
  })
})

describe('the pages', () => {
  it('counts them, and gives an empty file one', () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(1)).toBe(1)
    expect(pageCount(PAGE_BYTES)).toBe(1)
    expect(pageCount(PAGE_BYTES + 1)).toBe(2)
  })

  it('clamps a page into the file', () => {
    expect(clampPage(-4, PAGE_BYTES * 3)).toBe(0)
    expect(clampPage(99, PAGE_BYTES * 3)).toBe(2)
    expect(clampPage(NaN, PAGE_BYTES * 3)).toBe(0)
  })

  it('asks for exactly one page, inclusive at both ends', () => {
    expect(pageRange(0, PAGE_BYTES * 3)).toBe(`bytes=0-${PAGE_BYTES - 1}`)
    expect(pageRange(1, PAGE_BYTES * 3)).toBe(`bytes=${PAGE_BYTES}-${PAGE_BYTES * 2 - 1}`)
  })

  it('does not ask past the end of a short last page', () => {
    expect(pageRange(1, PAGE_BYTES + 10)).toBe(`bytes=${PAGE_BYTES}-${PAGE_BYTES + 9}`)
  })
})
