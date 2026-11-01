/**
 * A PICTURE'S SIZE FROM ITS HEADER (folder icons review, 2026-10-31, M2). The
 * page decodes a picked picture at full size before it scales it to 64 px, so
 * a 40,000 x 40,000 PNG of one colour (16 MB on disk) would want gigabytes and
 * could take the page down. Main reads the size from the header first and
 * refuses anything over `ICON_SIDE_MAX` a side, before the page sees a byte.
 *
 * Read by CONTENT, not by extension: the browser sniffs the bytes too, so a
 * `.jpg` that is really a PNG is measured as the PNG it decodes as. Bytes
 * that are none of these kinds give null (and are refused as not a picture).
 * SVG has no pixels of its own and is not measured here.
 */

export type PictureSize = { width: number; height: number }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const startsWith = (b: Uint8Array, at: number, bytes: readonly number[]): boolean =>
  b.length >= at + bytes.length && bytes.every((x, i) => b[at + i] === x)

const ascii = (b: Uint8Array, at: number, text: string): boolean =>
  startsWith(
    b,
    at,
    [...text].map((c) => c.charCodeAt(0))
  )

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)

const sized = (width: number, height: number): PictureSize | null =>
  width > 0 && height > 0 ? { width, height } : null

/** A PNG's width and height (signature, then IHDR first), or null. */
export function pngSize(b: Uint8Array): PictureSize | null {
  if (b.length < 33 || !startsWith(b, 0, PNG_SIGNATURE)) return null
  const v = view(b)
  // Chunk length 13, then "IHDR".
  if (v.getUint32(8) !== 13 || !ascii(b, 12, 'IHDR')) return null
  return sized(v.getUint32(16), v.getUint32(20))
}

function gifSize(b: Uint8Array): PictureSize | null {
  if (b.length < 10 || !(ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'))) return null
  const v = view(b)
  return sized(v.getUint16(6, true), v.getUint16(8, true))
}

function bmpSize(b: Uint8Array): PictureSize | null {
  if (b.length < 26 || !ascii(b, 0, 'BM')) return null
  const v = view(b)
  // BITMAPCOREHEADER (12 bytes) has 16-bit sizes; every later header 32-bit,
  // with a negative height for a top-down picture.
  if (v.getUint32(14, true) === 12) return sized(v.getUint16(18, true), v.getUint16(20, true))
  return sized(Math.abs(v.getInt32(18, true)), Math.abs(v.getInt32(22, true)))
}

function jpegSize(b: Uint8Array): PictureSize | null {
  if (!startsWith(b, 0, [0xff, 0xd8])) return null
  const v = view(b)
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) return null
    while (i < b.length && b[i] === 0xff) i++ // fill bytes
    if (i >= b.length) return null
    const marker = b[i]
    // Markers with no length: TEM, RST0-7, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 1
      continue
    }
    if (i + 2 >= b.length) return null
    const len = v.getUint16(i + 1)
    // SOF0-SOF15, but not DHT (C4), JPG (C8) or DAC (CC): length, precision,
    // then height and width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 >= b.length) return null
      return sized(v.getUint16(i + 6), v.getUint16(i + 4))
    }
    if (len < 2) return null
    i += 1 + len
  }
  return null
}

function webpSize(b: Uint8Array): PictureSize | null {
  if (b.length < 30 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null
  const v = view(b)
  if (ascii(b, 12, 'VP8 ')) {
    // Key frame start code, then 14-bit width and height.
    if (!startsWith(b, 23, [0x9d, 0x01, 0x2a])) return null
    return sized(v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff)
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null
    const bits = v.getUint32(21, true)
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (ascii(b, 12, 'VP8X')) {
    const u24 = (at: number): number => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)
    return sized(u24(24) + 1, u24(27) + 1)
  }
  return null
}

/** The largest picture in an ICO: a directory byte of 0 is 256, and an entry
 *  that is a PNG inside is measured by its own header. */
function icoSize(b: Uint8Array): PictureSize | null {
  if (!startsWith(b, 0, [0, 0, 1, 0]) || b.length < 6) return null
  const v = view(b)
  const count = v.getUint16(4, true)
  if (!count) return null
  let width = 0
  let height = 0
  for (let k = 0; k < count; k++) {
    const at = 6 + 16 * k
    if (at + 16 > b.length) return null
    let w = b[at] || 256
    let h = b[at + 1] || 256
    const offset = v.getUint32(at + 12, true)
    if (startsWith(b, offset, PNG_SIGNATURE)) {
      const inner = pngSize(b.subarray(offset))
      if (!inner) return null
      w = inner.width
      h = inner.height
    }
    width = Math.max(width, w)
    height = Math.max(height, h)
  }
  return sized(width, height)
}

/** The size the browser would decode these bytes at, or null when they are
 *  no PNG, JPEG, GIF, BMP, WEBP or ICO it can read the header of. */
export function pictureSize(b: Uint8Array): PictureSize | null {
  return pngSize(b) ?? jpegSize(b) ?? gifSize(b) ?? bmpSize(b) ?? webpSize(b) ?? icoSize(b)
}
