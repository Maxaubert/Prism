/**
 * What shape a text file is in, so saving it puts it back the same way.
 *
 * Two bugs lived here (2026-08-30), both of the "Prism quietly corrupted my
 * file" kind, and both invisible until the damage was committed:
 *
 * ENCODING. Every read was `readFile(p, 'utf-8')`. A `.reg` file is UTF-16LE
 * by definition and Prism claims `.reg`; PowerShell 5.1's `>` and `Out-File`
 * write UTF-16LE too, and so does Notepad's "Unicode". Those opened as
 * mojibake, and Prism then offered to save the mojibake back over them.
 *
 * LINE ENDINGS. CodeMirror rejoins its document with `\n` whatever it read,
 * so saving a CRLF file rewrote every line in it. Fixing one typo in a `.bat`
 * showed up as 400 changed lines in git, which is not a diff anyone can read.
 *
 * The sniff is BOM-only and deliberately so. Guessing UTF-16 from interleaved
 * NUL bytes mis-fires on binary-ish text and turns a working file into
 * nonsense, and every real Windows producer of UTF-16 writes the BOM.
 */

export type TextEncoding = 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be'
export type Eol = 'lf' | 'crlf'

export interface TextShape {
  encoding: TextEncoding
  eol: Eol
}

const BOM_UTF8 = [0xef, 0xbb, 0xbf]

/** The encoding a byte-order mark declares. utf8 when there is none. */
export function sniffEncoding(head: Uint8Array): TextEncoding {
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf8-bom'
  // FF FE 00 00 is UTF-32LE, whose first two bytes are UTF-16LE's mark. Prism
  // does not read UTF-32; calling it UTF-16 would produce NUL-riddled text, so
  // it falls through to utf8 and looks wrong rather than pretending.
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) {
    if (head.length >= 4 && head[2] === 0x00 && head[3] === 0x00) return 'utf8'
    return 'utf16le'
  }
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return 'utf16be'
  return 'utf8'
}

/** Decode a whole file, reporting what it turned out to be. */
export function decodeText(buf: Buffer): { text: string; encoding: TextEncoding } {
  const encoding = sniffEncoding(buf.subarray(0, 4))
  switch (encoding) {
    case 'utf16le':
      // TextDecoder strips the mark itself, for utf-8 and utf-16 alike.
      return { text: new TextDecoder('utf-16le').decode(buf), encoding }
    case 'utf16be':
      return { text: new TextDecoder('utf-16be').decode(buf), encoding }
    default:
      return { text: new TextDecoder('utf-8').decode(buf), encoding }
  }
}

/**
 * Which line ending the file uses.
 *
 * CRLF wins a tie, and wins an empty or single-line file: this runs on
 * Windows, every native tool here writes CRLF, and the cost of being wrong is
 * asymmetric - guessing LF on a CRLF file rewrites the whole file on the
 * first save, while guessing CRLF on a one-line LF file changes one byte.
 */
export function detectEol(text: string): Eol {
  const lf = (text.match(/\n/g) ?? []).length
  if (!lf) return 'crlf'
  const crlf = (text.match(/\r\n/g) ?? []).length
  return crlf >= lf - crlf ? 'crlf' : 'lf'
}

/** Put the text back in the shape the file was in. */
export function encodeText(text: string, shape: TextShape): Buffer {
  // Normalise first, so a buffer that picked up mixed endings comes out
  // consistent rather than gaining a stray \r\r\n.
  const body =
    shape.eol === 'crlf' ? text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : text.replace(/\r\n/g, '\n')
  switch (shape.encoding) {
    case 'utf8-bom':
      return Buffer.concat([Buffer.from(BOM_UTF8), Buffer.from(body, 'utf8')])
    case 'utf16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')])
    case 'utf16be': {
      const le = Buffer.from(body, 'utf16le')
      const be = Buffer.alloc(le.length)
      for (let i = 0; i + 1 < le.length; i += 2) {
        be[i] = le[i + 1]
        be[i + 1] = le[i]
      }
      return Buffer.concat([Buffer.from([0xfe, 0xff]), be])
    }
    default:
      return Buffer.from(body, 'utf8')
  }
}

/** Everything about the file a save has to reproduce. */
export function shapeOf(buf: Buffer): { text: string } & TextShape {
  const { text, encoding } = decodeText(buf)
  return { text, encoding, eol: detectEol(text) }
}
