import { describe, expect, it } from 'vitest'
import { parseByteRange } from './byteRange'

// A Range header read per RFC 7233 (#23, 2026-11-01): a suffix is the LAST
// bytes, a start past the end is a 416, and a header we cannot read is
// ignored (the whole file, 200), never guessed at.
describe('parseByteRange', () => {
  const total = 10

  it('reads an absolute range, clamping the end to the file', () => {
    expect(parseByteRange('bytes=2-5', total)).toEqual({ start: 2, end: 5 })
    expect(parseByteRange('bytes=7-', total)).toEqual({ start: 7, end: 9 })
    expect(parseByteRange('bytes=8-999', total)).toEqual({ start: 8, end: 9 })
    expect(parseByteRange('bytes=0-0', total)).toEqual({ start: 0, end: 0 })
  })

  it('reads a suffix range as the LAST n bytes', () => {
    expect(parseByteRange('bytes=-3', total)).toEqual({ start: 7, end: 9 })
    // Longer than the file: the whole file.
    expect(parseByteRange('bytes=-500', total)).toEqual({ start: 0, end: 9 })
  })

  it('calls a start at or past the end unsatisfiable', () => {
    expect(parseByteRange('bytes=10-', total)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=10-20', total)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=-0', total)).toBe('unsatisfiable')
  })

  it('finds nothing satisfiable in an empty file', () => {
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=0-10', 0)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=-5', 0)).toBe('unsatisfiable')
  })

  it('ignores a header it cannot read (the whole file is served)', () => {
    expect(parseByteRange(null, total)).toBeNull()
    expect(parseByteRange('', total)).toBeNull()
    expect(parseByteRange('bytes=', total)).toBeNull()
    expect(parseByteRange('bytes=-', total)).toBeNull()
    expect(parseByteRange('bytes=5-2', total)).toBeNull()
    expect(parseByteRange('items=0-5', total)).toBeNull()
    expect(parseByteRange('bytes=a-b', total)).toBeNull()
    // Several ranges would be a multipart answer, which this server does not make.
    expect(parseByteRange('bytes=0-1,4-5', total)).toBeNull()
  })

  it('takes the unit case-insensitively and spaces around the spec', () => {
    expect(parseByteRange('Bytes= 2-5 ', total)).toEqual({ start: 2, end: 5 })
  })

  it('clamps a last byte or a suffix too big to count, rather than ignoring it (review of #23)', () => {
    // RFC 7233: a last-byte past the end is the end; a suffix longer than the
    // file is the whole file. Past 2^53 is still "past the end".
    expect(parseByteRange('bytes=0-99999999999999999999', total)).toEqual({ start: 0, end: 9 })
    expect(parseByteRange('bytes=3-99999999999999999999', total)).toEqual({ start: 3, end: 9 })
    expect(parseByteRange('bytes=-99999999999999999999', total)).toEqual({ start: 0, end: 9 })
    expect(parseByteRange('bytes=-99999999999999999999', 0)).toBe('unsatisfiable')
    // A start that big is past any file there is: unsatisfiable.
    expect(parseByteRange('bytes=99999999999999999999-', total)).toBe('unsatisfiable')
  })
})
