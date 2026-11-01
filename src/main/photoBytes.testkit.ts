/**
 * Photo bytes built by hand, for the tests of what Prism reads out of a photo
 * (#78). Never imported by the app. Each builder writes the smallest thing a
 * reader accepts: an ICC profile with only a name, a TIFF block with only the
 * tags asked for, a JPEG of segments with no picture, a HEIC of bare boxes.
 */

type Entry =
  | { tag: number; ascii: string }
  | { tag: number; short: number }
  | { tag: number; long: number }
  | { tag: number; rational: [number, number] }

/** One big-endian IFD at `at` (from the TIFF start), its values after it. */
function ifd(entries: Entry[], at: number, next = 0): Buffer {
  const head = 2 + entries.length * 12 + 4
  const table = Buffer.alloc(head)
  const data: Buffer[] = []
  let dataAt = at + head
  table.writeUInt16BE(entries.length, 0)
  entries.forEach((e, i) => {
    const p = 2 + i * 12
    table.writeUInt16BE(e.tag, p)
    if ('ascii' in e) {
      const bytes = Buffer.from(e.ascii + '\0', 'latin1')
      table.writeUInt16BE(2, p + 2)
      table.writeUInt32BE(bytes.length, p + 4)
      if (bytes.length <= 4) bytes.copy(table, p + 8)
      else {
        table.writeUInt32BE(dataAt, p + 8)
        data.push(bytes)
        dataAt += bytes.length
      }
    } else if ('short' in e) {
      table.writeUInt16BE(3, p + 2)
      table.writeUInt32BE(1, p + 4)
      table.writeUInt16BE(e.short, p + 8)
    } else if ('long' in e) {
      table.writeUInt16BE(4, p + 2)
      table.writeUInt32BE(1, p + 4)
      table.writeUInt32BE(e.long, p + 8)
    } else {
      const bytes = Buffer.alloc(8)
      bytes.writeUInt32BE(e.rational[0], 0)
      bytes.writeUInt32BE(e.rational[1], 4)
      table.writeUInt16BE(5, p + 2)
      table.writeUInt32BE(1, p + 4)
      table.writeUInt32BE(dataAt, p + 8)
      data.push(bytes)
      dataAt += 8
    }
  })
  table.writeUInt32BE(next, head - 4)
  return Buffer.concat([table, ...data])
}

export interface CameraTags {
  make?: string
  model?: string
  /** Seconds as a fraction, [1, 250] for 1/250s. */
  exposure?: [number, number]
  fNumber?: [number, number]
  iso?: number
  focal?: [number, number]
  /** EXIF ColorSpace: 1 sRGB, 65535 uncalibrated. */
  colorSpace?: number
}

/** A big-endian TIFF block holding IFD0 and an Exif IFD. */
export function tiffBlock(t: CameraTags): Buffer {
  const header = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8])
  const exif: Entry[] = []
  if (t.exposure) exif.push({ tag: 0x829a, rational: t.exposure })
  if (t.fNumber) exif.push({ tag: 0x829d, rational: t.fNumber })
  if (t.iso !== undefined) exif.push({ tag: 0x8827, short: t.iso })
  if (t.colorSpace !== undefined) exif.push({ tag: 0xa001, short: t.colorSpace })
  if (t.focal) exif.push({ tag: 0x920a, rational: t.focal })
  const zero: Entry[] = []
  if (t.make) zero.push({ tag: 0x010f, ascii: t.make })
  if (t.model) zero.push({ tag: 0x0110, ascii: t.model })
  // The pointer's value is the Exif IFD's place, which follows IFD0 whole.
  const pointer = { tag: 0x8769, long: 0 }
  const first = ifd([...zero, pointer], 8)
  pointer.long = 8 + first.length
  return Buffer.concat([header, ifd([...zero, pointer], 8), ifd(exif, pointer.long)])
}

/** An ICC profile whose only tag is its description. */
export function iccProfile(
  name: string,
  type: 'desc' | 'mluc',
  entries: [string, string, string][] = [['en', 'US', name]]
): Buffer {
  let tag: Buffer
  if (type === 'desc') {
    const text = Buffer.from(name + '\0', 'latin1')
    tag = Buffer.alloc(12 + text.length)
    tag.write('desc', 0, 'latin1')
    tag.writeUInt32BE(text.length, 8)
    text.copy(tag, 12)
  } else {
    const strings = entries.map(([, , text]) => Buffer.from(text, 'utf16le').swap16())
    const recs = Buffer.alloc(16 + entries.length * 12)
    recs.write('mluc', 0, 'latin1')
    recs.writeUInt32BE(entries.length, 8)
    recs.writeUInt32BE(12, 12)
    let at = recs.length
    entries.forEach(([lang, country], i) => {
      const p = 16 + i * 12
      recs.write(lang, p, 'latin1')
      recs.write(country, p + 2, 'latin1')
      recs.writeUInt32BE(strings[i].length, p + 4)
      recs.writeUInt32BE(at, p + 8)
      at += strings[i].length
    })
    tag = Buffer.concat([recs, ...strings])
  }
  const head = Buffer.alloc(144)
  head.writeUInt32BE(144 + tag.length, 0)
  head.writeUInt32BE(type === 'desc' ? 0x02100000 : 0x04300000, 8)
  head.write('mntrRGB XYZ ', 12, 'latin1')
  head.write('acsp', 36, 'latin1')
  head.writeUInt32BE(1, 128)
  head.write('desc', 132, 'latin1')
  head.writeUInt32BE(144, 136)
  head.writeUInt32BE(tag.length, 140)
  return Buffer.concat([head, tag])
}

const segment = (marker: number, body: Buffer): Buffer => {
  const head = Buffer.alloc(4)
  head.writeUInt16BE(marker, 0)
  head.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([head, body])
}

/** A JPEG of metadata segments only: SOI, APP1 Exif, APP2 ICC, EOI. */
export function jpegWith(o: { tags?: CameraTags; icc?: Buffer }): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]
  if (o.tags) parts.push(segment(0xffe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffBlock(o.tags)])))
  if (o.icc) {
    parts.push(segment(0xffe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), o.icc])))
  }
  parts.push(Buffer.from([0xff, 0xd9]))
  return Buffer.concat(parts)
}

/** An ISO-BMFF box. */
export function box(kind: string, ...body: Buffer[]): Buffer {
  const inner = Buffer.concat(body)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + inner.length, 0)
  head.write(kind, 4, 'latin1')
  return Buffer.concat([head, inner])
}

/** A full box: four bytes of version and flags first. */
export const fullBox = (kind: string, ...body: Buffer[]): Buffer => box(kind, Buffer.alloc(4), ...body)

/** A HEIC of boxes only: ftyp, then meta holding iprp > ipco > the colr boxes given. */
export function heicWith(colrs: Buffer[]): Buffer {
  const ftyp = box('ftyp', Buffer.from('heic\0\0\0\0mif1heic', 'latin1'))
  const hdlr = fullBox('hdlr', Buffer.from('\0\0\0\0pict\0\0\0\0\0\0\0\0\0\0\0\0\0', 'latin1'))
  return Buffer.concat([ftyp, fullBox('meta', hdlr, box('iprp', box('ipco', ...colrs)))])
}

/** A `colr` property: an ICC profile (`prof`) or the coded numbers (`nclx`). */
export function colr(kind: 'prof' | 'nclx', icc?: Buffer): Buffer {
  return kind === 'prof'
    ? box('colr', Buffer.from('prof', 'latin1'), icc ?? Buffer.alloc(0))
    : box('colr', Buffer.from('nclx', 'latin1'), Buffer.from([0, 12, 0, 13, 0, 6, 0x80]))
}
