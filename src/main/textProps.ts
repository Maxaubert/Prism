import type { TextProps } from '@shared/props'

/**
 * A text file's encoding and line endings, read from its first bytes for the
 * Properties window's Encoding and Line endings rows (owner, 2026-10-12;
 * spec `docs/superpowers/specs/2026-10-12-properties-window-design.md`).
 *
 * The bytes, not the text: by the time the editor holds a string the BOM and
 * the original endings are gone. Pure, so the IPC handler only reads.
 */

/** At most this much of the file is looked at. */
export const TEXT_PROBE_BYTES = 64 * 1024

/**
 * Valid UTF-8, with one allowance: a sequence cut off by the end of a
 * PARTIAL read is not a fault (the probe reads 64 KB, which can end
 * mid-character).
 */
function isUtf8(bytes: Uint8Array, whole: boolean): boolean {
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) {
      i++
      continue
    }
    const need =
      b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : -1
    if (need < 0) return false
    for (let k = 1; k <= need; k++) {
      if (i + k >= bytes.length) return !whole
      const c = bytes[i + k]
      if (c < 0x80 || c > 0xbf) return false
      // The overlong and out-of-range second bytes UTF-8 forbids.
      if (
        k === 1 &&
        ((b === 0xe0 && c < 0xa0) || (b === 0xf0 && c < 0x90) || (b === 0xf4 && c > 0x8f))
      )
        return false
    }
    i += need + 1
  }
  return true
}

/** No BOM but every other byte zero: UTF-16 all the same (a Windows tool's
 *  output, mostly). Which half is zero says the byte order. */
function utf16WithoutBom(bytes: Uint8Array): 'UTF-16 LE' | 'UTF-16 BE' | null {
  const n = bytes.length - (bytes.length % 2)
  if (n < 4) return null
  let evenZero = 0
  let oddZero = 0
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZero++
    if (bytes[i + 1] === 0) oddZero++
  }
  const pairs = n / 2
  if (oddZero > pairs * 0.4 && evenZero < pairs * 0.05) return 'UTF-16 LE'
  if (evenZero > pairs * 0.4 && oddZero < pairs * 0.05) return 'UTF-16 BE'
  return null
}

function decode(bytes: Uint8Array, encoding: string, skip: number): string {
  const body = Buffer.from(bytes.buffer, bytes.byteOffset + skip, bytes.length - skip)
  if (encoding === 'UTF-16 LE') return body.toString('utf16le')
  if (encoding === 'UTF-16 BE') {
    const swapped = Buffer.from(body.subarray(0, body.length - (body.length % 2)))
    return swapped.swap16().toString('utf16le')
  }
  // Line endings are ASCII in UTF-8 and Windows-1252 alike.
  return body.toString('latin1')
}

function lineEndings(text: string, whole: boolean): TextProps['eol'] {
  // A partial read that stops on a CR may be half of a CRLF: not counted.
  const t = !whole && text.endsWith('\r') ? text.slice(0, -1) : text
  let crlf = 0
  let lf = 0
  let cr = 0
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 13) {
      if (t.charCodeAt(i + 1) === 10) {
        crlf++
        i++
      } else cr++
    } else if (c === 10) lf++
  }
  const kinds = (crlf ? 1 : 0) + (lf ? 1 : 0) + (cr ? 1 : 0)
  if (kinds === 0) return 'None'
  if (kinds > 1) return 'Mixed'
  return crlf ? 'CRLF' : lf ? 'LF' : 'CR'
}

/**
 * Encoding, BOM and line endings of `bytes`, the start of a file. `whole` is
 * false when the file goes on past them, so a cut-off last character or a
 * trailing CR is not held against it.
 */
export function detectText(bytes: Uint8Array, whole = true): TextProps {
  let encoding: string
  let bom = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'UTF-8'
    bom = 3
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'UTF-16 LE'
    bom = 2
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'UTF-16 BE'
    bom = 2
  } else {
    encoding = utf16WithoutBom(bytes) ?? (isUtf8(bytes, whole) ? 'UTF-8' : 'Windows-1252')
  }
  return { encoding, bom: bom > 0, eol: lineEndings(decode(bytes, encoding, bom), whole) }
}
