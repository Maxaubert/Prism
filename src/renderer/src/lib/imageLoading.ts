/**
 * Whether the image viewer's spinner shows.
 *
 * `loaded` is never reset between files (it drives the first fade-in only,
 * see ImageView), which left one hole (review, 2026-10-16): stepping onto a
 * picture past the canvas path's size swaps in a still-empty canvas while
 * `createImageBitmap` works for seconds, and `loaded` was already true from
 * the picture before - a blank checkerboard and no spinner. The huge path now
 * counts as loading until ITS bitmap has been painted.
 *
 * Since #28 the bitmap is made BEFORE the swap (lib/imageReady), so between
 * pictures the ring comes from ImageView's `switching` over the old picture;
 * this stays the guard for the first huge picture a viewer opens.
 */
export function imageStillLoading<T>(
  loaded: boolean,
  huge: boolean,
  img: T | null,
  paintedHuge: T | null
): boolean {
  return !loaded || (huge && img !== paintedHuge)
}
