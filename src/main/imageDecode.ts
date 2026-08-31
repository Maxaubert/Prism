import { execFile } from 'child_process'
import { extname } from 'path'

/**
 * Stills Chromium cannot draw, decoded to PNG by the bundled ffmpeg.
 *
 * The same shape as the HEIC path beside it: main turns the file into
 * something the renderer can simply put in an <img>, and caches the result so
 * arrowing back and forth through a folder does not re-decode. HEIC keeps its
 * own route (a pure-JS libheif worker) because it predates the ffmpeg bundle
 * and works without it.
 *
 * Photoshop files land here too: ffmpeg reads the flattened composite that
 * every PSD carries, which is exactly what a viewer wants to show.
 */
const FFMPEG_IMAGES = new Set([
  '.tga', '.targa', '.pcx', '.psd', '.exr', '.dpx', '.sgi', '.dds',
  '.ppm', '.pgm', '.pbm', '.pnm', '.jp2', '.j2k', '.qoi', '.hdr', '.xbm', '.xpm',
  // TIFF and JPEG XL were on the viewable list from the start, and Chromium
  // draws NEITHER - a .tiff simply showed nothing (measured 2026-08-24, and
  // Chrome removed its JXL decoder in 2023). Both decode here instead.
  '.tiff', '.tif', '.jxl'
])

export function needsImageDecode(path: string): boolean {
  return FFMPEG_IMAGES.has(extname(path).toLowerCase())
}

export const decodableImages = (): string[] => [...FFMPEG_IMAGES]

/**
 * ffmpeg argv for "one frame of this, as PNG, on stdout".
 *
 * EXR and Radiance HDR hold LINEAR, high-dynamic-range light, and squeezing
 * that into 8 bits by truncation blows every highlight out (2026-08-30).
 * MEASURED on the bundled ffmpeg: a synthetic linear EXR clipped 31.6% of its
 * pixels to pure white through the plain args, and 0% through the tonemap.
 *
 * Gated strictly on those two extensions: `tonemap` assumes linear input, so
 * running it over an ordinary 8-bit .tga or .psd would darken a correct
 * picture. `format=gbrpf32le` rather than the usual `zscale=t=linear` chain,
 * because EXR frames carry unspecified primaries and zscale refuses them
 * ("no path between colorspaces").
 */
export function imageArgs(file: string): string[] {
  const hdr = /\.(exr|hdr)$/i.test(file)
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-i', file,
    '-frames:v', '1',
    ...(hdr ? ['-vf', 'format=gbrpf32le,tonemap=hable:desat=0,format=rgba'] : []),
    // Some of these carry an alpha channel; rgba keeps it rather than
    // compositing onto a colour the file never asked for.
    '-pix_fmt', 'rgba',
    '-c:v', 'png',
    '-f', 'image2',
    'pipe:1'
  ]
}

const cache = new Map<string, Buffer>()
const CACHE_MAX = 6

/** Decode one still to PNG bytes. Keyed by path + mtime, so an edit re-decodes. */
export async function decodeImage(ffmpeg: string, file: string, mtimeMs: number): Promise<Buffer> {
  const key = `${file}|${mtimeMs}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit) // LRU touch
    return hit
  }
  const png = await new Promise<Buffer>((resolve, reject) => {
    execFile(
      ffmpeg,
      imageArgs(file),
      { timeout: 20000, maxBuffer: 256 << 20, encoding: 'buffer' },
      (err, stdout) => {
        if (err || !stdout?.length) reject(new Error('ffmpeg could not decode this image'))
        else resolve(stdout as Buffer)
      }
    )
  })
  cache.set(key, png)
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  return png
}

/**
 * How many pages a TIFF holds.
 *
 * ffmpeg cannot reach page 2 at all - MEASURED on a two-IFD file, `ffmpeg -i
 * multi.tif -f null -` reports `frame= 1` and nb_frames is N/A - so this is a
 * HINT, not a page picker: scans and faxes arrive as multi-page TIFFs
 * constantly, and showing page 1 of 12 with no indication that the other
 * eleven exist is the kind of silence that costs someone a document.
 *
 * A TIFF is a linked list of image file directories. The header names the
 * first at byte 4; each one is a count followed by 12-byte entries and then
 * the offset of the next, or 0. Read in small windows, never by slurping the
 * file: main is one thread, and a big synchronous read there stalls every
 * window and the media Range handler with it.
 */
export async function tiffPages(file: string): Promise<number> {
  let fh: import('fs/promises').FileHandle | null = null
  try {
    const { open } = await import('fs/promises')
    fh = await open(file, 'r')
    const head = Buffer.alloc(8)
    await fh.read(head, 0, 8, 0)
    const le = head[0] === 0x49 && head[1] === 0x49
    const be = head[0] === 0x4d && head[1] === 0x4d
    if (!le && !be) return 1
    const magic = le ? head.readUInt16LE(2) : head.readUInt16BE(2)
    if (magic !== 42) return 1 // 43 is BigTIFF, a different layout
    const u16 = (b: Buffer, o: number): number => (le ? b.readUInt16LE(o) : b.readUInt16BE(o))
    const u32 = (b: Buffer, o: number): number => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
    let next = u32(head, 4)
    let pages = 0
    const seen = new Set<number>()
    // Capped: a corrupt chain must not become a loop, and nobody needs an
    // exact count past this to know the file has more than one page.
    while (next > 0 && pages < 64 && !seen.has(next)) {
      seen.add(next)
      const countBuf = Buffer.alloc(2)
      const got = await fh.read(countBuf, 0, 2, next)
      if (got.bytesRead < 2) break
      const entries = u16(countBuf, 0)
      pages += 1
      const nextBuf = Buffer.alloc(4)
      const at = next + 2 + entries * 12
      const gotNext = await fh.read(nextBuf, 0, 4, at)
      if (gotNext.bytesRead < 4) break
      next = u32(nextBuf, 0)
    }
    return Math.max(1, pages)
  } catch {
    return 1
  } finally {
    await fh?.close().catch(() => {})
  }
}
