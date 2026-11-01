import exifr from 'exifr'
import { heifExifBlock, heifIccProfile, isHeif } from './heifExif'
import { iccName } from './iccName'
import type { PhotoInfo } from '@shared/ipcTypes'

/**
 * What the camera wrote into the photo.
 *
 * Read from the PATH, in main, and that is a correctness argument before it is
 * a performance one (2026-08-31). The renderer's copy of a picture is not the
 * file: a HEIC has been through heic-convert, a camera RAW is the embedded
 * JPEG rawPreview.ts dug out, and a Targa or an EXR is a PNG ffmpeg made.
 * All three arrive with their metadata stripped, so parsing what the renderer
 * holds returns nothing for exactly the photos worth asking about.
 *
 * A path also costs almost nothing: exifr reads the file in chunks and stops
 * once it has the segments it was asked for - measured at 2 reads and 131KB
 * on a 2.1MB JPEG - where handing it a Buffer would mean reading the whole
 * file into main, which is the mistake the performance rules already paid for.
 *
 * Everything here is best-effort. A photo with no EXIF is not an error, it is
 * a photo with no EXIF, so every field is optional and a parse failure is an
 * empty answer rather than a throw.
 */

export type { PhotoInfo }

/** "1/250" for a fast shutter, "2.5s" for a slow one. */
function shutter(seconds: unknown): string | null {
  const s = typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : null
  if (s === null || s <= 0) return null
  return s >= 1 ? `${Number(s.toFixed(1))}s` : `1/${Math.round(1 / s)}s`
}

const trim = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

const OPTS = {
  tiff: true,
  exif: true,
  gps: true,
  // MakerNote is where a lot of lens names live, and it is also megabytes of
  // vendor-specific binary. Off: a lens name is not worth the read.
  makerNote: false,
  xmp: false,
  iptc: false
} as const

/** The same, plus the ICC profile, which is where a phone photo's real colour
 *  space lives (#78, D8, owner 2026-11-01). A JPEG's APP2 and a PNG's iCCP
 *  sit near the start, before the picture data, so it is one more small
 *  segment, not a longer read. */
const FILE_OPTS = { ...OPTS, icc: true } as const

export async function photoInfo(file: string): Promise<PhotoInfo> {
  let tags: Record<string, unknown> | undefined
  try {
    // HEIC first, and not as a fallback: exifr's sniffer refuses a container
    // whose ftyp box is over 50 bytes, which every recent iPhone photo is.
    // See heifExif.ts - it hands over the TIFF block, which exifr is happy to
    // parse once it is not being asked to recognise the container. Its colour
    // profile is a `colr` box beside it, read the same way.
    if (isHeif(file)) {
      const [block, icc] = await Promise.all([heifExifBlock(file), heifIccProfile(file)])
      const colour = icc ? iccName(icc) : null
      if (block || colour) {
        tags = block ? ((await exifr.parse(block, OPTS).catch(() => undefined)) as Record<string, unknown> | undefined) : undefined
        const out = tags ? shape(tags) : {}
        if (colour) out.colour = colour
        return out
      }
    }
    tags = (await exifr.parse(file, FILE_OPTS)) as Record<string, unknown> | undefined
  } catch {
    // "Unknown file format" for an SVG, a truncated header, anything.
    return {}
  }
  return tags ? shape(tags) : {}
}

/** exifr's ProfileDescription: a string, or one entry per language for a
 *  version 4 profile with several. */
function profileName(v: unknown): string | null {
  if (typeof v === 'string') return trim(v)
  if (Array.isArray(v)) {
    const entries = v.filter((e): e is { lang?: string; text?: string } => !!e && typeof e === 'object')
    const en = entries.find((e) => e.lang === 'en') ?? entries[0]
    return trim(en?.text)
  }
  return null
}

/** The tags Prism shows, from whatever exifr gave back. */
function shape(tags: Record<string, unknown>): PhotoInfo {
  const out: PhotoInfo = {}

  const make = trim(tags.Make)
  const model = trim(tags.Model)
  // "Canon" + "Canon EOS R6" reads as a stutter; the model usually carries the
  // make already, and when it does not the two are joined.
  if (model) out.camera = make && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : model
  else if (make) out.camera = make

  out.lens = trim(tags.LensModel) ?? trim(tags.LensMake) ?? undefined

  const parts: string[] = []
  const sh = shutter(tags.ExposureTime)
  if (sh) parts.push(sh)
  if (typeof tags.FNumber === 'number' && Number.isFinite(tags.FNumber)) {
    parts.push(`f/${Number(tags.FNumber.toFixed(1))}`)
  }
  const iso = Array.isArray(tags.ISO) ? tags.ISO[0] : tags.ISO
  if (typeof iso === 'number' && Number.isFinite(iso)) parts.push(`ISO ${iso}`)
  if (typeof tags.FocalLength === 'number' && Number.isFinite(tags.FocalLength)) {
    parts.push(`${Math.round(tags.FocalLength)}mm`)
  }
  if (parts.length) out.exposure = parts.join('  ')

  const when = tags.DateTimeOriginal ?? tags.CreateDate ?? tags.ModifyDate
  if (when instanceof Date && !Number.isNaN(when.getTime())) out.taken = when.toLocaleString()

  // 1 is sRGB and is worth saying. 65535 means "uncalibrated", which is what
  // every iPhone writes because the real space lives in the ICC profile - a
  // row reading "Uncalibrated" on every phone photo teaches nothing, so there
  // is no row at all.
  // The ICC profile's own name says it better, and is the only place a
  // Display P3 photo says so at all (#78, D8, owner 2026-11-01).
  const profile = profileName(tags.ProfileDescription)
  if (profile) out.colour = profile
  else if (tags.ColorSpace === 1) out.colour = 'sRGB'

  const lat = tags.latitude
  const lon = tags.longitude
  if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) {
    out.gps = { lat, lon }
  }

  const w = tags.ExifImageWidth ?? tags.ImageWidth
  const h = tags.ExifImageHeight ?? tags.ImageHeight
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
    out.dimensions = `${w} x ${h}`
  }

  return out
}
