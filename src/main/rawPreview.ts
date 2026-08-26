import { openSync, readSync, closeSync, statSync } from 'fs'
import { extname } from 'path'

/**
 * Camera raw files, shown as the preview the camera itself embedded.
 *
 * A raw file is sensor data, not a picture: turning one into an image means
 * demosaicing, white balance and a colour pipeline - LibRaw's job, and a
 * native module Prism does not have. But every camera writes a full-size JPEG
 * preview into the file, which is exactly what Explorer, Lightroom's grid and
 * every other fast viewer actually show you. Prism shows that.
 *
 * So this is honest but limited: it is the camera's rendering, not a
 * development of the raw data, and edits made in another program are not in
 * it. For a viewer whose whole promise is "open it now", that is the right
 * trade.
 */

const RAW_EXTS = new Set([
  '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.raf', '.orf',
  '.rw2', '.pef', '.dng', '.raw', '.dcr', '.kdc', '.mrw', '.x3f', '.3fr', '.erf'
])

export function isRaw(path: string): boolean {
  return RAW_EXTS.has(extname(path).toLowerCase())
}

export const rawExtensions = (): string[] => [...RAW_EXTS]

/** How much of a file to scan for previews. Even a 100MB raw puts its JPEGs
 *  near the front; reading the whole thing to find them would cost more than
 *  it saves. */
const SCAN_BYTES = 40 << 20

/**
 * The largest embedded JPEG in a buffer, or null.
 *
 * Raw files are TIFF-shaped, and the previews sit in IFDs whose offsets vary
 * by maker and model - Canon, Nikon, Sony and Fuji all differ, and Fuji does
 * not even use TIFF. Rather than a parser per manufacturer, this scans for
 * JPEG start/end markers and keeps the biggest run, which is the full-size
 * preview in every format tried. A thumbnail is 160px and would be useless;
 * taking the LARGEST is what makes this work.
 */
export function findJpeg(buf: Buffer): Buffer | null {
  let best: { start: number; end: number } | null = null
  let i = 0
  while (i < buf.length - 1) {
    // SOI: ff d8 ff
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      const end = findEoi(buf, i + 2)
      if (end > 0) {
        const size = end - i
        if (!best || size > best.end - best.start) best = { start: i, end }
        i = end
        continue
      }
    }
    i++
  }
  if (!best) return null
  const out = buf.subarray(best.start, best.end)
  // A few hundred bytes is a corrupt fragment, not a picture.
  return out.length > 4096 ? out : null
}

/** The end-of-image marker that closes the JPEG starting before `from`. */
function findEoi(buf: Buffer, from: number): number {
  for (let i = from; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd9) return i + 2
  }
  return -1
}

const cache = new Map<string, Buffer>()
const CACHE_MAX = 4

/** The embedded preview of a raw file, as JPEG bytes. Throws if there is none. */
export function rawPreview(path: string, mtimeMs: number): Buffer {
  const key = `${path}|${mtimeMs}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit) // LRU touch
    return hit
  }
  const size = statSync(path).size
  const want = Math.min(size, SCAN_BYTES)
  const buf = Buffer.alloc(want)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buf, 0, want, 0)
  } finally {
    closeSync(fd)
  }
  const jpeg = findJpeg(buf)
  if (!jpeg) throw new Error('no embedded preview in this raw file')
  cache.set(key, jpeg)
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  return jpeg
}
