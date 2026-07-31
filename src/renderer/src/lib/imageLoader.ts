// Shared image cache for the viewer.
//
// Caches the fetched BYTES (blob + object url) and the image's dimensions, read
// cheaply from the file header. Measured inside Prism on a 384 MP / 2 MB PNG:
// fetching ~210ms, decoding ~3ms. Decoded bitmaps are deliberately NOT retained —
// an earlier version pinned them to make back-nav "instant", which bought ~3ms
// while forcing Chromium to hold hundreds of MB of bitmaps, and the resulting GC
// pauses stalled the renderer. Cache the expensive part (the read) only.

const TTL_MS = 60_000 // drop images not visited in a minute
const CEILING_BYTES = 400 * 1024 * 1024 // cap on retained (compressed) bytes

export interface LoadedImage {
  objectUrl: string
  blob: Blob
  /** 0 when the header couldn't be parsed. */
  width: number
  height: number
}

interface Entry extends LoadedImage {
  bytes: number
  lastUsed: number
}

const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<Entry>>()

function free(url: string, e: Entry): void {
  URL.revokeObjectURL(e.objectUrl)
  cache.delete(url)
}

/** Evict entries past their TTL, then trim least-recently-used until under the
 *  ceiling. The just-touched entry is always newest, so it is never evicted. */
function sweep(): void {
  const now = Date.now()
  for (const [url, e] of cache) {
    if (now - e.lastUsed > TTL_MS) free(url, e)
  }
  let total = 0
  for (const e of cache.values()) total += e.bytes
  if (total <= CEILING_BYTES) return
  const byAge = [...cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  for (const [url, e] of byAge) {
    if (total <= CEILING_BYTES) break
    total -= e.bytes
    free(url, e)
  }
}

setInterval(sweep, 20_000)

/** Read pixel dimensions straight from the file header, without decoding. Returns
 *  [0, 0] for formats we don't parse. Used to route very large images down the
 *  off-main-thread decode path. */
async function probeDimensions(blob: Blob): Promise<[number, number]> {
  try {
    const h = new Uint8Array(await blob.slice(0, 65536).arrayBuffer())
    const be16 = (o: number): number => (h[o] << 8) | h[o + 1]
    const be32 = (o: number): number => ((h[o] << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) >>> 0
    const le16 = (o: number): number => h[o] | (h[o + 1] << 8)

    // PNG: 8-byte signature, then IHDR carrying width/height at 16/20.
    if (h.length > 24 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) {
      return [be32(16), be32(20)]
    }
    // GIF: logical screen size at offset 6, little-endian.
    if (h.length > 10 && h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) {
      return [le16(6), le16(8)]
    }
    // JPEG: walk the segments to the start-of-frame marker, which carries the size.
    if (h.length > 4 && h[0] === 0xff && h[1] === 0xd8) {
      let i = 2
      while (i + 9 < h.length) {
        if (h[i] !== 0xff) {
          i += 1
          continue
        }
        const marker = h[i + 1]
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2
          continue
        }
        // SOF0..SOF15, excluding the huffman/arithmetic/restart tables (C4/C8/CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return [be16(i + 7), be16(i + 5)]
        }
        i += 2 + be16(i + 2)
      }
      return [0, 0]
    }
    // WebP: RIFF container, size depends on the VP8 flavour.
    if (h.length > 30 && h[0] === 0x52 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42) {
      const fmt = String.fromCharCode(h[12], h[13], h[14], h[15])
      if (fmt === 'VP8 ') return [le16(26) & 0x3fff, le16(28) & 0x3fff]
      if (fmt === 'VP8L') {
        const b = h[21] | (h[22] << 8) | (h[23] << 16) | (h[24] << 24)
        return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]
      }
      if (fmt === 'VP8X') {
        return [1 + (h[24] | (h[25] << 8) | (h[26] << 16)), 1 + (h[27] | (h[28] << 8) | (h[29] << 16))]
      }
    }
  } catch {
    /* unreadable header; caller falls back to the plain <img> path */
  }
  return [0, 0]
}

async function fetchEntry(url: string): Promise<Entry> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  // response.blob() lets the browser drain the body off the JS main thread.
  const blob = await res.blob()
  const [width, height] = await probeDimensions(blob)
  const entry: Entry = {
    objectUrl: URL.createObjectURL(blob),
    blob,
    width,
    height,
    bytes: blob.size,
    lastUsed: Date.now()
  }
  cache.set(url, entry)
  sweep()
  return entry
}

/** Load an image's bytes + dimensions, cached across navigation. */
export function loadImage(url: string): Promise<LoadedImage> {
  const hit = cache.get(url)
  if (hit) {
    hit.lastUsed = Date.now()
    return Promise.resolve(hit)
  }
  let promise = inflight.get(url)
  if (!promise) {
    promise = fetchEntry(url).finally(() => inflight.delete(url))
    inflight.set(url, promise)
  }
  return promise
}

/** Warm the cache for a neighbour, ignoring errors. */
export function preloadImage(url: string): void {
  if (cache.has(url) || inflight.has(url)) return
  void loadImage(url).catch(() => {})
}
