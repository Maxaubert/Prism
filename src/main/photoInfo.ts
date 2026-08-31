import exifr from 'exifr'
import { heifExifBlock, isHeif } from './heifExif'

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

export interface PhotoInfo {
  camera?: string
  lens?: string
  /** "1/250s f/2.8 ISO 400", already assembled: the three are read together. */
  exposure?: string
  taken?: string
  colour?: string
  /** Decimal degrees, as exifr merges them. */
  gps?: { lat: number; lon: number }
  dimensions?: string
}

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

export async function photoInfo(file: string): Promise<PhotoInfo> {
  let tags: Record<string, unknown> | undefined
  try {
    // HEIC first, and not as a fallback: exifr's sniffer refuses a container
    // whose ftyp box is over 50 bytes, which every recent iPhone photo is.
    // See heifExif.ts - it hands over the TIFF block, which exifr is happy to
    // parse once it is not being asked to recognise the container.
    if (isHeif(file)) {
      const block = await heifExifBlock(file)
      if (block) {
        tags = (await exifr.parse(block, OPTS)) as Record<string, unknown> | undefined
        return tags ? shape(tags) : {}
      }
    }
    tags = (await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      // MakerNote is where a lot of lens names live, and it is also megabytes
      // of vendor-specific binary. Off: a lens name is not worth the read.
      makerNote: false,
      xmp: false,
      iptc: false
    })) as Record<string, unknown> | undefined
  } catch {
    // "Unknown file format" for an SVG, a truncated header, anything.
    return {}
  }
  return tags ? shape(tags) : {}
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
  if (tags.ColorSpace === 1) out.colour = 'sRGB'

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
