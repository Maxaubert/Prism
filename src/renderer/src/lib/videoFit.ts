/**
 * How the picture sits in the frame (2026-08-27), the way every player has
 * offered since VLC: fit, fill, stretch, a forced ratio, or the file's own
 * pixels.
 *
 * Two different ideas share this menu, and the names keep them apart:
 *
 *  - HOW IT IS SCALED: fit (letterbox, the default), fill (crop to the frame),
 *    stretch (squash to the frame).
 *  - WHAT SHAPE IT IS: 16:9 and 4:3 force the display ratio, which is what
 *    rescues a file whose header lies about its own shape.
 *
 * 'native' is VLC's 1:1: one video pixel to one screen pixel, cropped by the
 * window rather than scaled to it.
 */
export type VideoFit = 'fit' | 'fill' | 'stretch' | '16:9' | '4:3' | 'native'

export const VIDEO_FITS: Array<{ id: VideoFit; label: string; hint: string }> = [
  { id: 'fit', label: 'Fit to window', hint: 'The whole picture, letterboxed where it has to be.' },
  { id: 'fill', label: 'Fill window', hint: 'Fill the frame and crop what does not fit.' },
  { id: 'stretch', label: 'Stretch', hint: 'Squash the picture to the window, ratio and all.' },
  { id: '16:9', label: '16:9', hint: 'Force a widescreen ratio.' },
  { id: '4:3', label: '4:3', hint: 'Force a 4:3 ratio.' },
  { id: 'native', label: 'Original size', hint: 'One video pixel to one screen pixel.' }
]

/** The style for the <video> element under each mode. */
export function fitStyle(fit: VideoFit): { className: string; style: React.CSSProperties } {
  switch (fit) {
    case 'fill':
      return { className: 'h-full w-full object-cover', style: {} }
    case 'stretch':
      return { className: 'h-full w-full object-fill', style: {} }
    case '16:9':
    case '4:3':
      // The picture is forced to that shape, and still kept inside the window:
      // object-fill does the forcing, aspect-ratio does the shape, and the max
      // rules stop a wide window from pushing it off the top and bottom.
      return {
        className: 'max-h-full max-w-full object-fill',
        style: { aspectRatio: fit.replace(':', ' / '), height: '100%', width: 'auto' }
      }
    case 'native':
      // Its own pixels, centred, clipped by the window - VLC's 1:1.
      return { className: 'max-w-none object-none', style: { width: '100%', height: '100%' } }
    default:
      return { className: 'h-full w-full object-contain', style: {} }
  }
}
