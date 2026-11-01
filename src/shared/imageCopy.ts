import { fileKind } from './fileKind'
import { extOf } from './path'

/**
 * THE FORMATS A PICTURE CAN BE SAVED AS (#474; owner, 2026-11-01: "cant it
 * offer more, i hear jxl is getting pretty popular and very good"). One list
 * for both menus, the picture's "Save a copy" and the Explorer's "Save copies
 * as", so they cannot drift apart.
 *
 * JPEG and PNG of ONE picture are still the canvas's (as since 2026-08-31);
 * WebP, AVIF and JPEG XL are encoded in main by the bundled ffmpeg, which has
 * libwebp, libaom and libjxl. Every copy of MANY pictures is ffmpeg's
 * (`src/main/imageEncode.ts`).
 */
export type CopyFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'jxl'

export const COPY_FORMATS: ReadonlyArray<{ format: CopyFormat; label: string; ext: string }> = [
  { format: 'jpeg', label: 'JPEG', ext: 'jpg' },
  { format: 'png', label: 'PNG', ext: 'png' },
  { format: 'webp', label: 'WebP', ext: 'webp' },
  { format: 'avif', label: 'AVIF', ext: 'avif' },
  { format: 'jxl', label: 'JPEG XL', ext: 'jxl' }
]

export function isCopyFormat(v: unknown): v is CopyFormat {
  return COPY_FORMATS.some((f) => f.format === v)
}

/** "jpg" for JPEG, and so on: the copy's extension, no dot. */
export const copyExt = (format: CopyFormat): string =>
  COPY_FORMATS.find((f) => f.format === format)?.ext ?? 'png'

export const copyLabel = (format: CopyFormat): string =>
  COPY_FORMATS.find((f) => f.format === format)?.label ?? format

/** The formats the canvas cannot make, so main encodes them from a PNG. */
export const mainEncodes = (format: CopyFormat): boolean => format !== 'jpeg' && format !== 'png'

/**
 * Can a copy be made of this file: a picture Prism shows, except an SVG,
 * which is a drawing and which the bundled ffmpeg cannot read (no librsvg).
 * Folders and every other kind are skipped by a batch, and said so.
 */
export function canCopyImage(path: string): boolean {
  const ext = extOf(path)
  return ext !== '.svg' && fileKind(ext) === 'image'
}
