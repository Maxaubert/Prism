import { describe, expect, it } from 'vitest'
import { decodeText, detectEol, encodeText, shapeOf, sniffEncoding } from './textFile'

/**
 * A save must put the file back the way it found it.
 *
 * Both of these were real: a `.reg` opened as mojibake and could be saved
 * back as mojibake, and fixing one typo in a `.bat` rewrote every line
 * because CodeMirror rejoins with `\n` whatever it read.
 */

const utf16le = (s: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')])

describe('sniffing an encoding', () => {
  it('reads a UTF-8 BOM', () => {
    expect(sniffEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe('utf8-bom')
  })

  it('reads UTF-16LE, which is what .reg and PowerShell 5.1 write', () => {
    expect(sniffEncoding(utf16le('a'))).toBe('utf16le')
  })

  it('reads UTF-16BE', () => {
    expect(sniffEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x61]))).toBe('utf16be')
  })

  it('does not mistake UTF-32LE for UTF-16LE', () => {
    // Its first two bytes are UTF-16LE's mark. Prism cannot read UTF-32, and
    // claiming otherwise would produce NUL-riddled text.
    expect(sniffEncoding(Buffer.from([0xff, 0xfe, 0x00, 0x00]))).toBe('utf8')
  })

  it('calls a plain file utf8, and never guesses from NUL bytes', () => {
    expect(sniffEncoding(Buffer.from('hello'))).toBe('utf8')
    expect(sniffEncoding(Buffer.from([0x61, 0x00, 0x62, 0x00]))).toBe('utf8')
  })

  it('survives a file too short to hold a mark', () => {
    expect(sniffEncoding(Buffer.from([]))).toBe('utf8')
    expect(sniffEncoding(Buffer.from([0xff]))).toBe('utf8')
  })
})

describe('decoding', () => {
  it('drops the mark from the text, for every encoding that has one', () => {
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hi')])).text).toBe('hi')
    expect(decodeText(utf16le('hi')).text).toBe('hi')
  })

  it('reads a real .reg header', () => {
    const src = 'Windows Registry Editor Version 5.00\r\n'
    expect(decodeText(utf16le(src)).text).toBe(src)
  })
})

describe('detecting line endings', () => {
  it('sees CRLF', () => expect(detectEol('a\r\nb\r\n')).toBe('crlf'))
  it('sees LF', () => expect(detectEol('a\nb\nc\n')).toBe('lf'))
  it('calls a file with no newline at all CRLF, because this is Windows', () => {
    expect(detectEol('one line')).toBe('crlf')
  })
  it('gives a mixed file to the majority, CRLF winning a tie', () => {
    expect(detectEol('a\r\nb\nc\r\n')).toBe('crlf')
    expect(detectEol('a\r\nb\nc\nd\n')).toBe('lf')
  })
})

describe('a round trip changes nothing it was not asked to change', () => {
  it.each([
    ['plain utf8, lf', Buffer.from('a\nb\n')],
    ['utf8 with a BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\nb\r\n')])],
    ['utf16le, crlf', utf16le('a\r\nb\r\n')],
    ['utf16be, crlf', (() => {
      const le = Buffer.from('a\r\nb\r\n', 'utf16le')
      const be = Buffer.alloc(le.length)
      for (let i = 0; i + 1 < le.length; i += 2) {
        be[i] = le[i + 1]
        be[i + 1] = le[i]
      }
      return Buffer.concat([Buffer.from([0xfe, 0xff]), be])
    })()]
  ])('%s', (_name, original) => {
    const { text, encoding, eol } = shapeOf(original)
    expect(encodeText(text, { encoding, eol })).toEqual(original)
  })

  it('does not touch a CRLF file when the editor hands back LF', () => {
    // This is the actual bug: CodeMirror's doc.toString() always joins with \n.
    const original = Buffer.from('one\r\ntwo\r\nthree\r\n')
    const { encoding, eol } = shapeOf(original)
    expect(encodeText('one\ntwo\nthree\n', { encoding, eol })).toEqual(original)
  })

  it('normalises rather than doubling when the buffer is already mixed', () => {
    expect(encodeText('a\r\nb\nc', { encoding: 'utf8', eol: 'crlf' }).toString()).toBe('a\r\nb\r\nc')
  })

  it('strips CR when the file is an LF file', () => {
    expect(encodeText('a\r\nb', { encoding: 'utf8', eol: 'lf' }).toString()).toBe('a\nb')
  })
})
