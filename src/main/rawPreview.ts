import { open } from 'fs/promises'
import { extname } from 'path'
import { createLru } from './lru'

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
  // buf.indexOf, not a byte-by-byte JS loop (review, 2026-10-16): the loop
  // cost 40-50 ms of main's one thread per 40 MB scan, every step through a
  // folder of raws and every neighbour preload. Same markers, native search.
  let i = buf.indexOf(SOI)
  while (i >= 0) {
    const eoi = buf.indexOf(EOI, i + 2)
    // No end marker after this start means none after any later start either.
    if (eoi < 0) break
    const end = eoi + 2
    if (!best || end - i > best.end - best.start) best = { start: i, end }
    i = buf.indexOf(SOI, end)
  }
  if (!best) return null
  // A few hundred bytes is a corrupt fragment, not a picture.
  if (best.end - best.start <= 4096) return null
  // A COPY, not a subarray (review, 2026-10-16): a subarray kept the whole
  // 25-40 MB scan buffer alive behind every cached preview, four of them.
  // allocUnsafeSlow: its own memory, exactly this size, never a pool slab.
  const out = Buffer.allocUnsafeSlow(best.end - best.start)
  buf.copy(out, 0, best.start, best.end)
  return out
}

const SOI = Buffer.from([0xff, 0xd8, 0xff])
const EOI = Buffer.from([0xff, 0xd9])

const cache = createLru<string, Buffer>(4)

/** The embedded preview of a raw file, as JPEG bytes. Throws if there is none.
 *
 *  The read is ASYNC (2026-08-26): up to 40MB off disk with readSync stopped
 *  the whole main process - every window, every IPC reply - for as long as the
 *  disk took, which on a card reader or a network share is not a moment. */
export async function rawPreview(path: string, mtimeMs: number): Promise<Buffer> {
  const key = `${path}|${mtimeMs}`
  const hit = cache.get(key) // a hit is a use: the newest again
  if (hit) return hit
  // The size from the open handle, not a statSync first (owner, 2026-10-12,
  // main never waits on the disk). A missing file still throws, at the open.
  const fd = await open(path, 'r')
  let buf: Buffer
  try {
    const want = Math.min((await fd.stat()).size, SCAN_BYTES)
    buf = Buffer.alloc(want)
    await fd.read(buf, 0, want, 0)
  } finally {
    await fd.close()
  }
  const jpeg = findJpeg(buf)
  if (!jpeg) throw new Error('no embedded preview in this raw file')
  cache.set(key, jpeg)
  return jpeg
}
