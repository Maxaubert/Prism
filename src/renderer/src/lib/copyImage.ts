/**
 * Putting the picture on the clipboard.
 *
 * The commonest thing anyone does with a photo, and for HEIC, camera RAW and
 * the ffmpeg-decoded formats it is the thing Windows genuinely cannot do:
 * those files are not PNG or JPEG bytes, so "copy the file" hands the other
 * application something it cannot open. This copies PIXELS.
 *
 * Two rules the sources have to follow:
 *
 * NOT the on-screen element. The <img> carries the zoom, pan and rotation
 * transform, and those are how you are LOOKING at the picture, not what it
 * is. A copy has to be the picture.
 *
 * NOT the big-image canvas. Over 40MP, ImageView draws a bitmap downscaled to
 * a 2560px edge for raster cost; copying from that would silently hand over a
 * shrunken picture with no way to tell.
 */

/** Is there a frame to take? A file whose picture Prism cannot decode has none. */
export function videoHasFrame(el: {
  readyState: number
  videoWidth: number
  videoHeight: number
} | null): boolean {
  // HAVE_CURRENT_DATA: something is actually decoded. Width and height are 0
  // for an audio-only file, and for a video whose codec Chromium refused.
  return !!el && el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0
}

async function toPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer | null> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  return blob ? await blob.arrayBuffer() : null
}

/** The full-size picture, from the bytes it was decoded from. */
export async function pngFromBlob(blob: Blob | null): Promise<ArrayBuffer | null> {
  if (!blob) return null
  const bmp = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0)
    return await toPng(canvas)
  } finally {
    bmp.close()
  }
}

/** The frame showing now, at the video's own resolution. */
export async function pngFromVideo(el: HTMLVideoElement | null): Promise<ArrayBuffer | null> {
  if (!videoHasFrame(el) || !el) return null
  const canvas = document.createElement('canvas')
  canvas.width = el.videoWidth
  canvas.height = el.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // The element is fetched crossOrigin="anonymous" (the 200% volume work did
  // that for Web Audio), so the canvas is not tainted and toBlob works. Were
  // it not, this would throw a SecurityError rather than return silence.
  ctx.drawImage(el, 0, 0)
  return await toPng(canvas)
}
