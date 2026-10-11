import { describe, expect, it } from 'vitest'
import { detectText } from './textProps'

const bytes = (...parts: Array<string | number[]>): Uint8Array =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf8') : Buffer.from(p))))

describe('detectText', () => {
  it('reads plain ASCII with LF as UTF-8', () => {
    expect(detectText(bytes('a\nb\n'))).toEqual({ encoding: 'UTF-8', bom: false, eol: 'LF' })
  })
  it('sees a UTF-8 BOM and CRLF', () => {
    expect(detectText(bytes([0xef, 0xbb, 0xbf], 'æøå\r\nx\r\n'))).toEqual({
      encoding: 'UTF-8',
      bom: true,
      eol: 'CRLF'
    })
  })
  it('reads UTF-16 by its BOM, both byte orders', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a\r\nb\r\n', 'utf16le')])
    expect(detectText(le)).toEqual({ encoding: 'UTF-16 LE', bom: true, eol: 'CRLF' })
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('a\nb\n', 'utf16le').swap16()])
    expect(detectText(be)).toEqual({ encoding: 'UTF-16 BE', bom: true, eol: 'LF' })
  })
  it('reads UTF-16 LE with no BOM by its zero bytes', () => {
    expect(detectText(Buffer.from('hello\r\nworld\r\n', 'utf16le')).encoding).toBe('UTF-16 LE')
  })
  it('calls bytes that are not UTF-8 Windows-1252', () => {
    expect(detectText(bytes('caf', [0xe9], '\n')).encoding).toBe('Windows-1252')
    // An overlong encoding is not UTF-8 either.
    expect(detectText(bytes([0xc0, 0xaf])).encoding).toBe('Windows-1252')
  })
  it('forgives a character cut off by a partial read, not by the end of the file', () => {
    const cut = bytes('ab', [0xc3])
    expect(detectText(cut, false).encoding).toBe('UTF-8')
    expect(detectText(cut, true).encoding).toBe('Windows-1252')
  })
  it('names the line endings', () => {
    expect(detectText(bytes('a\rb\r')).eol).toBe('CR')
    expect(detectText(bytes('a\r\nb\n')).eol).toBe('Mixed')
    expect(detectText(bytes('one line')).eol).toBe('None')
    expect(detectText(bytes('')).eol).toBe('None')
  })
  it('does not count a CR at the end of a partial read', () => {
    expect(detectText(bytes('a\r\nb\r'), false).eol).toBe('CRLF')
    expect(detectText(bytes('a\r\nb\r'), true).eol).toBe('Mixed')
  })
})
