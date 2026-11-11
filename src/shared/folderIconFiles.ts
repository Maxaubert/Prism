/**
 * FOLDER ICONS FROM A FILE (owner, 2026-10-31: "or the user can also pick their
 * own icon from a file, and it will remember the folder location of where the
 * user picked an icon the last time"). What main and the page agree on.
 *
 * The page never gets a path to load: main reads the picked file and hands
 * over its bytes, the page turns them into a 64 px PNG, main checks and keeps
 * that copy under userData by its hash, and the page draws the copies as data
 * URLs. Nothing outside Prism's own folder is ever served (the root wall).
 *
 * MORE KINDS (owner, 2026-11-11: "let me pick more image types, if it has to
 * convert to a specific format thats fine but then we handle that"). Every
 * still Prism's viewer shows can be an icon. The kinds the page decodes itself
 * go over as they are; every other kind (JPEG XL, AVIF, TIFF, HEIC, PSD, a
 * camera raw...) is CONVERTED IN MAIN first, the way the viewer shows it.
 */

import { imageExtensions } from './fileKind'

/** The kinds the page decodes itself (D7), by extension, and the type each is read as. */
export const ICON_FILE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
}

/** Every other still the viewer shows (`fileKind`'s image list): main turns
 *  it into a picture the page can decode before a byte goes over. AVIF is
 *  here too: the page could draw it, but main cannot read its size from the
 *  header, so ffmpeg makes it small first. */
export const ICON_CONVERTED_EXTS: readonly string[] = imageExtensions()
  .map((e) => e.slice(1))
  .filter((e) => !Object.hasOwn(ICON_FILE_TYPES, e))

/** The open dialog's filter: every kind, the page's own first. */
export const ICON_FILE_EXTS: readonly string[] = [...Object.keys(ICON_FILE_TYPES), ...ICON_CONVERTED_EXTS]

/** The type a file of extension `ext` (no dot, any case) is read as, or null.
 *  Own keys only (review L1): `.constructor` or `.toString` must not find
 *  Object's built-ins and pass as a picture. */
export function iconFileType(ext: string): string | null {
  const key = ext.toLowerCase()
  return Object.hasOwn(ICON_FILE_TYPES, key) ? ICON_FILE_TYPES[key] : null
}

/** True when a file of extension `ext` (no dot, any case) is converted in main first. */
export function isConvertedIcon(ext: string): boolean {
  return ICON_CONVERTED_EXTS.includes(ext.toLowerCase())
}

/** A picked file bigger than this is refused (it is a picture for a 16 px row). */
export const ICON_SOURCE_MAX = 16 * 1024 * 1024

/** A file main converts may be bigger (a TIFF scan, a layered PSD): ffmpeg
 *  reads it from its path in its own process, and only the small result goes
 *  to the page. */
export const ICON_CONVERTED_MAX = 256 * 1024 * 1024

/** ffmpeg makes a converted picture at most this many pixels a side, so a
 *  huge TIFF never becomes a huge PNG (the page then draws it at 64). */
export const ICON_CONVERT_PX = 256

/** A picture wider or taller than this is refused before the page decodes it
 *  (review M2): a decode is full size, and 40,000 px a side wants gigabytes. */
export const ICON_SIDE_MAX = 8192

/** The kept copy's square: 64 covers the largest row icon (18 px) at 225%. */
export const ICON_PX = 64

/** A kept copy's id: the SHA-256 of its PNG, in hex. */
export const ICON_ID = /^[0-9a-f]{64}$/

/** Why a picked file cannot be an icon. `no-decoder`: the kind needs ffmpeg,
 *  and this install has none. */
export type IconRefusal = 'not-picture' | 'too-big' | 'too-large' | 'unreadable' | 'no-decoder'

/** The pick: null when cancelled, else the file's bytes or why not. */
export type IconPick = null | { bytes: Uint8Array; type: string } | { refused: IconRefusal }

/** Every kept copy as `{ id: dataUrl }`. `complete` is false when a read
 *  failed for a reason other than the copy being gone (a file held by an
 *  antivirus scan, review M1): such a list must never drop an entry. */
export type IconList = { files: Record<string, string>; complete: boolean }

/** The kept copy, or why main would not keep it. */
export type IconSave = { id: string; url: string } | { refused: 'not-picture' }
