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
 * VLC's 1:1 ('native') was offered and cut (owner, 2026-08-27): on a 4K file
 * in a small window it shows a corner of the picture, which reads as a bug.
 */
export type VideoFit = 'fit' | 'fill' | 'stretch' | '16:9' | '4:3'

export const VIDEO_FITS: Array<{ id: VideoFit; label: string; hint: string }> = [
  { id: 'fit', label: 'Fit to window', hint: 'The whole picture, letterboxed where it has to be.' },
  { id: 'fill', label: 'Fill window', hint: 'Fill the frame and crop what does not fit.' },
  { id: 'stretch', label: 'Stretch', hint: 'Squash the picture to the window, ratio and all.' },
  { id: '16:9', label: '16:9', hint: 'Force a widescreen ratio.' },
  { id: '4:3', label: '4:3', hint: 'Force a 4:3 ratio.' }
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
    default:
      return { className: 'h-full w-full object-contain', style: {} }
  }
}
