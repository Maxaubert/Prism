import type { LoadedImage } from './imageLoader'

// Above this resolution Chromium rasterizes a visible <img> on the MAIN thread:
// measured at 2.3s of hard freeze for a 384 MP PNG, during which nothing paints
// (so the loading spinner never appeared and navigation appeared to hang).
// createImageBitmap does the same work entirely off-thread, so such images are
// decoded to a display-sized bitmap and shown on a canvas instead.
export const CANVAS_PATH_PIXELS = 40_000_000
// Longest edge of that bitmap. Sharp at a step or two of zoom while staying cheap
// to rasterize: measured, 4096 cost ~550ms of raster on display, 2560 ~200ms.
export const MAX_EDGE = 2560

/** Whether a picture goes down the canvas path. */
export const isHugeImage = (img: LoadedImage): boolean => img.width * img.height > CANVAS_PATH_PIXELS

/** A picture that can be drawn the moment it is mounted. */
export interface ReadyImage {
  img: LoadedImage
  /** The huge path's display-sized bitmap, for the canvas to take. */
  bitmap: ImageBitmap | null
  /** What the decoded element measured, for formats the header parser
   *  cannot read (SVG, AVIF, BMP, ICO). */
  natural: { w: number; h: number } | null
  /** An ordinary picture that was decoded ahead, so the mounted <img> can
   *  draw it in the commit that mounts it (`decoding="sync"`) instead of
   *  painting one blank frame first (review, 2026-10-31). */
  decoded: boolean
}

export interface ReadyDeps {
  /** Decode an ordinary picture off-screen; answers its natural size.
   *  `signal`: the viewer moved on, so the decode is dropped. */
  decode: (objectUrl: string, signal?: AbortSignal) => Promise<{ w: number; h: number }>
  /** The huge path's bitmap, resized while it decodes. */
  bitmap: (blob: Blob, w: number, h: number) => Promise<ImageBitmap>
}

const browserDeps: ReadyDeps = {
  decode: async (objectUrl, signal) => {
    const el = new Image()
    // Emptying the source makes a pending decode() reject, which is the only
    // way to stop one.
    const drop = (): void => void el.removeAttribute('src')
    signal?.addEventListener('abort', drop, { once: true })
    el.src = objectUrl
    try {
      await el.decode()
    } finally {
      signal?.removeEventListener('abort', drop)
    }
    return { w: el.naturalWidth, h: el.naturalHeight }
  },
  bitmap: (blob, w, h) =>
    createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
}

/**
 * Make the next picture drawable BEFORE it replaces the one on screen (#28).
 *
 * The viewer keeps the last picture until the next is ready, but "ready" used
 * to mean "fetched": crossing between an ordinary picture and one past 40 MP
 * swapped the <img> for an empty canvas (or back) the moment the bytes landed,
 * and the stage sat blank for the whole decode, seconds on a big scan. Now the
 * decode happens first, off-screen: a huge picture becomes its bitmap, an
 * ordinary one is decoded by a detached element (the mounted <img> then draws
 * from that decode). Until then the old picture stays up, with the ring and
 * the dim over it (`switching`).
 *
 * An ordinary picture whose early decode refuses still swaps: the mounted
 * element's own load or error then decides, as it always did. A huge one
 * whose bitmap cannot be made fails, as its canvas path did.
 */
export async function readyImage(
  img: LoadedImage,
  signal?: AbortSignal,
  deps: ReadyDeps = browserDeps
): Promise<ReadyImage> {
  if (isHugeImage(img)) {
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
    const bitmap = await deps.bitmap(
      img.blob,
      Math.max(1, Math.round(img.width * scale)),
      Math.max(1, Math.round(img.height * scale))
    )
    return { img, bitmap, natural: null, decoded: false }
  }
  try {
    const natural = await deps.decode(img.objectUrl, signal)
    return { img, bitmap: null, natural: natural.w && natural.h ? natural : null, decoded: true }
  } catch {
    return { img, bitmap: null, natural: null, decoded: false }
  }
}
