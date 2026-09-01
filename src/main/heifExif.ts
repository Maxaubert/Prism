import { open, type FileHandle } from 'fs/promises'

/**
 * The Exif block inside a HEIC, dug out by hand.
 *
 * exifr REFUSES most iPhone HEICs, and the reason is worth writing down
 * because it looks like the file is at fault (2026-08-31). Its sniffer reads
 * the `ftyp` box size and gives up if it is over 50 bytes:
 *
 *   canHandle(file, marker) { if (marker !== 0) return false
 *                             const size = file.getUint16(2)
 *                             if (size > 50) return false ... }
 *
 * A photo off an iPhone 16 has a 52-byte `ftyp` - one compatible brand too
 * many - so exifr answers "Unknown file format" for precisely the pictures
 * this feature exists for. MEASURED on a real 3.5MB iPhone HEIC.
 *
 * So Prism finds the Exif item itself. HEIC is ISO base media format: the
 * `meta` box holds `iinf` (what the items are) and `iloc` (where they live),
 * and the item whose type is "Exif" points at a payload that begins with a
 * four-byte offset to an ordinary TIFF header - which exifr parses happily
 * once it is handed the bytes rather than the container.
 *
 * Small reads only: box headers, the two index boxes, and the Exif extent.
 * Never the whole file, which on a 3.5MB photo would be main's thread holding
 * megabytes for four camera fields.
 */

interface Box {
  at: number
  size: number
  kind: string
  headLen: number
}

async function readBox(fh: FileHandle, at: number): Promise<Box | null> {
  const head = Buffer.alloc(8)
  const { bytesRead } = await fh.read(head, 0, 8, at)
  if (bytesRead < 8) return null
  let size = head.readUInt32BE(0)
  const kind = head.toString('latin1', 4, 8)
  let headLen = 8
  if (size === 1) {
    // A 64-bit size lives in the eight bytes after the tag.
    const big = Buffer.alloc(8)
    await fh.read(big, 0, 8, at + 8)
    size = Number(big.readBigUInt64BE(0))
    headLen = 16
  }
  return { at, size, kind, headLen }
}

async function children(fh: FileHandle, start: number, end: number, skip = 0): Promise<Box[]> {
  const out: Box[] = []
  let at = start + skip
  // Capped: a corrupt length of 8 would otherwise walk the file one box at a
  // time, and a length of 0 would not move at all.
  for (let guard = 0; guard < 256 && at < end; guard += 1) {
    const b = await readBox(fh, at)
    if (!b || b.size < 8) break
    out.push(b)
    at += b.size
  }
  return out
}

const readN = (buf: Buffer, at: number, n: number): number => {
  if (n === 2) return buf.readUInt16BE(at)
  if (n === 4) return buf.readUInt32BE(at)
  if (n === 8) return Number(buf.readBigUInt64BE(at))
  return 0
}

/** The id of the item `iinf` calls "Exif", or null. */
function exifItemId(iinf: Buffer): number | null {
  const at = iinf.indexOf('Exif', 0, 'latin1')
  if (at < 0) return null
  // Walk back to the enclosing `infe` box and read the id that follows its
  // version and flags. Version 0 and 1 use a 16-bit id, version 2 and up 32.
  for (let j = at; j >= 8; j -= 1) {
    if (iinf.toString('latin1', j, j + 4) !== 'infe') continue
    const version = iinf.readUInt8(j + 4)
    return version >= 3 ? iinf.readUInt32BE(j + 8) : iinf.readUInt16BE(j + 8)
  }
  return null
}

/** Where item `id`'s bytes are, from `iloc`. */
function extentFor(iloc: Buffer, id: number): { offset: number; length: number } | null {
  const version = iloc.readUInt8(8)
  let p = 12
  const sizes = iloc.readUInt8(p)
  const offsetSize = sizes >> 4
  const lengthSize = sizes & 15
  const sizes2 = iloc.readUInt8(p + 1)
  const baseOffsetSize = sizes2 >> 4
  const indexSize = version >= 1 ? sizes2 & 15 : 0
  p += 2
  const count = version < 2 ? iloc.readUInt16BE(p) : iloc.readUInt32BE(p)
  p += version < 2 ? 2 : 4
  for (let i = 0; i < count && p < iloc.length; i += 1) {
    const itemId = version < 2 ? iloc.readUInt16BE(p) : iloc.readUInt32BE(p)
    p += version < 2 ? 2 : 4
    if (version >= 1) p += 2 // construction method
    p += 2 // data reference index
    const base = readN(iloc, p, baseOffsetSize)
    p += baseOffsetSize
    const extents = iloc.readUInt16BE(p)
    p += 2
    for (let e = 0; e < extents; e += 1) {
      p += indexSize
      const off = readN(iloc, p, offsetSize)
      p += offsetSize
      const len = readN(iloc, p, lengthSize)
      p += lengthSize
      // The first extent is the whole Exif block in every file seen; a
      // fragmented one would need joining, which no camera writes.
      if (itemId === id) return { offset: base + off, length: len }
    }
  }
  return null
}

/** True for the containers this walk understands. */
export function isHeif(file: string): boolean {
  return /\.(heic|heif|avif)$/i.test(file)
}

/** The TIFF block from a HEIC's Exif item, or null if it has none. */
export async function heifExifBlock(file: string): Promise<Buffer | null> {
  let fh: FileHandle | null = null
  try {
    fh = await open(file, 'r')
    const { size } = await fh.stat()
    const top = await children(fh, 0, size)
    const meta = top.find((b) => b.kind === 'meta')
    if (!meta) return null
    // `meta` is a FullBox: four bytes of version and flags before its children.
    const kids = await children(fh, meta.at + meta.headLen, meta.at + meta.size, 4)
    const iinf = kids.find((b) => b.kind === 'iinf')
    const iloc = kids.find((b) => b.kind === 'iloc')
    if (!iinf || !iloc) return null

    const iinfBuf = Buffer.alloc(iinf.size)
    await fh.read(iinfBuf, 0, iinf.size, iinf.at)
    const id = exifItemId(iinfBuf)
    if (id === null) return null

    const ilocBuf = Buffer.alloc(iloc.size)
    await fh.read(ilocBuf, 0, iloc.size, iloc.at)
    const at = extentFor(ilocBuf, id)
    // A sane ceiling: an Exif block is kilobytes. Anything claiming megabytes
    // is a misparse, and reading it would be the whole-file read this avoids.
    if (!at || at.length <= 4 || at.length > 4 << 20) return null

    const raw = Buffer.alloc(at.length)
    await fh.read(raw, 0, at.length, at.offset)
    // The payload begins with a four-byte offset to the TIFF header.
    const skip = raw.readUInt32BE(0)
    if (4 + skip >= raw.length) return null
    return raw.subarray(4 + skip)
  } catch {
    return null
  } finally {
    await fh?.close().catch(() => {})
  }
}
