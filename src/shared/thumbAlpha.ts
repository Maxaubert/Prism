/**
 * Which pictures get a thumbnail that keeps its clear parts (#477, owner,
 * 2026-11-01).
 *
 * The phone grid's 320px thumbnail was a JPEG for everything, and a JPEG has
 * no alpha: a transparent PNG's tile showed whatever colour sat under the
 * clear pixels, black in most. The owner chose "a checkerboard", the same
 * faint one the viewer draws, so the thumbnail of a format that CAN be clear
 * is a WebP with its alpha and the tile draws `.p-checker` behind it. Photos,
 * raws and videos cannot be clear and stay JPEGs, so their cache is untouched.
 *
 * Chosen by extension, never by reading the file: the key, the format and
 * the tile all have to agree before anything is decoded. An opaque PNG gets
 * a WebP too, which measured SMALLER than the JPEG it replaces (3.3 KB
 * against 8.6 KB on a 1080p test card at 320px).
 */
import { extOf } from './path'

export const THUMB_ALPHA_EXTS: ReadonlySet<string> = new Set([
  '.png', '.gif', '.webp', '.avif', '.jxl', '.tiff', '.tif', '.ico', '.bmp',
  '.tga', '.targa', '.psd', '.exr', '.dds', '.qoi', '.sgi', '.jp2', '.j2k', '.xpm'
])

/** True when `path`'s thumbnail is a WebP with alpha, drawn over the checker. */
export function thumbKeepsAlpha(path: string): boolean {
  return THUMB_ALPHA_EXTS.has(extOf(path))
}
