/**
 * The name an ICC colour profile gives itself ("Display P3", "sRGB
 * IEC61966-2.1"), or null (#78, D8, owner 2026-11-01).
 *
 * exifr reads this for a JPEG, PNG or TIFF (its `ProfileDescription`). A HEIC
 * is the exception: exifr cannot open the container (see heifExif.ts), so its
 * `colr` box's profile is handed here as bytes. Only the `desc` tag is read:
 * version 2 profiles write it as `desc` (ASCII), version 4 as `mluc` (UTF-16,
 * one string per language, English preferred). Every offset is checked
 * against the length, so a truncated profile is no name rather than a throw.
 */
export function iccName(icc: Buffer): string | null {
  if (icc.length < 132 || icc.toString('latin1', 36, 40) !== 'acsp') return null
  const count = icc.readUInt32BE(128)
  for (let i = 0; i < count && i < 256; i += 1) {
    const p = 132 + i * 12
    if (p + 12 > icc.length) return null
    if (icc.toString('latin1', p, p + 4) !== 'desc') continue
    const at = icc.readUInt32BE(p + 4)
    const len = icc.readUInt32BE(p + 8)
    if (at + len > icc.length || len < 12) return null
    return tidy(readDesc(icc.subarray(at, at + len)))
  }
  return null
}

function readDesc(tag: Buffer): string | null {
  const type = tag.toString('latin1', 0, 4)
  if (type === 'desc') {
    const n = tag.readUInt32BE(8)
    if (12 + n > tag.length) return null
    return tag.toString('latin1', 12, 12 + n)
  }
  if (type === 'mluc') {
    if (tag.length < 16) return null
    const records = tag.readUInt32BE(8)
    const size = tag.readUInt32BE(12)
    let pick: string | null = null
    for (let r = 0; r < records && r < 64; r += 1) {
      const p = 16 + r * size
      if (p + 12 > tag.length) break
      const lang = tag.toString('latin1', p, p + 2)
      const n = tag.readUInt32BE(p + 4)
      const at = tag.readUInt32BE(p + 8)
      if (at + n > tag.length) continue
      // UTF-16 big-endian: swapped to the little-endian Node reads. An odd
      // length (a broken record) drops its last byte rather than throwing.
      const text = Buffer.from(tag.subarray(at, at + n - (n % 2))).swap16().toString('utf16le')
      if (lang === 'en') return text
      pick ??= text
    }
    return pick
  }
  return null
}

const tidy = (s: string | null): string | null => {
  const t = s?.replace(/\0/g, '').trim()
  return t ? t : null
}
