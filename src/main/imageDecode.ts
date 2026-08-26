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

/** ffmpeg argv for "one frame of this, as PNG, on stdout". */
export function imageArgs(file: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-i', file,
    '-frames:v', '1',
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
