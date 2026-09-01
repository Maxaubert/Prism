import { fileKind } from './fileKind'

/**
 * Which members of a comic book are pages, and in what order (2026-08-31).
 *
 * A .cbz or .cbr is just an archive of pictures, and the order is the file
 * names - which is where it gets interesting. Real comics are numbered
 * `1.jpg, 2.jpg, ... 10.jpg` about as often as `001, 002, 010`, and a plain
 * string sort puts page 10 second. So the comparison is NUMERIC, the same
 * collator the folder listing already sorts by, and deliberately not the
 * archive panel's plain `localeCompare` (which has that bug and does not
 * matter there).
 *
 * They also carry things that are not pages: `ComicInfo.xml` metadata,
 * macOS `__MACOSX/` resource forks, `.DS_Store`, `Thumbs.db`. A viewer that
 * shows an XML file as page one looks broken, so the filter is a positive
 * one - it is a page if Prism would call it an image.
 */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Paths that are in the container but are not part of the book. */
function noise(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  const segments = p.split('/')
  // The resource fork of every file, which really does hold copies whose
  // names end in .jpg.
  if (segments.some((s) => s === '__MACOSX')) return true
  // A hidden folder, or a hidden file: neither is a page anybody drew.
  if (segments.some((s) => s.startsWith('.') && s.length > 1)) return true
  const name = segments[segments.length - 1]?.toLowerCase() ?? ''
  return name === 'thumbs.db' || name === 'desktop.ini'
}

const extOf = (path: string): string => {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const at = name.lastIndexOf('.')
  return at > 0 ? name.slice(at).toLowerCase() : ''
}

export interface ComicMember {
  path: string
  dir?: boolean
}

/**
 * The pages, in reading order.
 *
 * Sorted over the WHOLE path, so a comic split into `ch01/`, `ch02/` folders
 * reads through in order rather than interleaving its chapters.
 */
export function comicPages(entries: readonly ComicMember[]): string[] {
  return entries
    .filter((e) => !e.dir && !noise(e.path) && fileKind(extOf(e.path)) === 'image')
    .map((e) => e.path.replace(/\\/g, '/'))
    .sort((a, b) => collator.compare(a, b))
}
