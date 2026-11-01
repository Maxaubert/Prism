/**
 * FOLDER ICONS FROM A FILE (owner, 2026-10-31: "or the user can also pick their
 * own icon from a file, and it will remember the folder location of where the
 * user picked an icon the last time"). What main and the page agree on.
 *
 * The page never gets a path to load: main reads the picked file and hands
 * over its bytes, the page turns them into a 64 px PNG, main checks and keeps
 * that copy under userData by its hash, and the page draws the copies as data
 * URLs. Nothing outside Prism's own folder is ever served (the root wall).
 */

/** The kinds a picture can be (D7), by extension, and the type each is read as. */
export const ICON_FILE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
}

/** The open dialog's filter. */
export const ICON_FILE_EXTS: readonly string[] = Object.keys(ICON_FILE_TYPES)

/** The type a file of extension `ext` (no dot, any case) is read as, or null.
 *  Own keys only (review L1): `.constructor` or `.toString` must not find
 *  Object's built-ins and pass as a picture. */
export function iconFileType(ext: string): string | null {
  const key = ext.toLowerCase()
  return Object.hasOwn(ICON_FILE_TYPES, key) ? ICON_FILE_TYPES[key] : null
}

/** A picked file bigger than this is refused (it is a picture for a 16 px row). */
export const ICON_SOURCE_MAX = 16 * 1024 * 1024

/** A picture wider or taller than this is refused before the page decodes it
 *  (review M2): a decode is full size, and 40,000 px a side wants gigabytes. */
export const ICON_SIDE_MAX = 8192

/** The kept copy's square: 64 covers the largest row icon (18 px) at 225%. */
export const ICON_PX = 64

/** A kept copy's id: the SHA-256 of its PNG, in hex. */
export const ICON_ID = /^[0-9a-f]{64}$/

/** Why a picked file cannot be an icon. */
export type IconRefusal = 'not-picture' | 'too-big' | 'too-large' | 'unreadable'

/** The pick: null when cancelled, else the file's bytes or why not. */
export type IconPick = null | { bytes: Uint8Array; type: string } | { refused: IconRefusal }

/** Every kept copy as `{ id: dataUrl }`. `complete` is false when a read
 *  failed for a reason other than the copy being gone (a file held by an
 *  antivirus scan, review M1): such a list must never drop an entry. */
export type IconList = { files: Record<string, string>; complete: boolean }

/** The kept copy, or why main would not keep it. */
export type IconSave = { id: string; url: string } | { refused: 'not-picture' }
