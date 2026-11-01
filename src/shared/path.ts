/**
 * Path arithmetic for every layer (2026-10-12, the structure audit's Stage 2).
 *
 * Pure strings and no `node:path`, so the renderer and the phone page use the
 * same answers main does. The paths are Windows paths: either separator is
 * read, case never makes two paths different, and a trailing separator does
 * not either. Each rule below is the one most of the old copies had; where a
 * copy disagreed, the comment on the function says what it now answers.
 *
 * This is NOT the root wall. Main's canonical, symlink-aware checks
 * (`dirList.isInsideRoot`, `withinCanonical`) stay where they are: a string
 * cannot know where a link points.
 */

/** Either separator. */
const SEP = /[\\/]/

/** `p` without trailing separators: "C:\a\" -> "C:\a", "C:\" -> "C:". */
export function trimSep(p: string): string {
  return p.replace(/[\\/]+$/, '')
}

/**
 * The last name in a path, ignoring trailing separators: "C:\a\b.jpg" ->
 * "b.jpg", "C:\a\" -> "a". A drive root answers "C:". A path with no name in
 * it at all ("", "\") answers itself.
 */
export function baseName(p: string): string {
  return p.split(SEP).filter(Boolean).pop() ?? p
}

/**
 * Everything before the last separator: "C:\a\b.jpg" -> "C:\a". A file at a
 * drive root answers "C:" (no separator: callers that need the root add it),
 * and a bare name, or a separator only at the start, answers ''. A trailing
 * separator counts as the last one, so "C:\a\" -> "C:\a".
 */
export function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i <= 0 ? '' : p.slice(0, i)
}

/**
 * The extension of the last name in `p`, lower-cased, dot included: ".jpg",
 * or '' without one. A dotfile is all extension (".gitignore"), which is how
 * `fileKind` reads it; a dot in a FOLDER name never counts ("C:\a.b\c" -> '').
 * Main's `extname` answers '' for a dotfile; main keeps it where it uses it.
 */
export function extOf(p: string): string {
  return /\.[^.\\/]*$/.exec(p)?.[0]?.toLowerCase() ?? ''
}

/**
 * The form two spellings of one path share: backslashes, no trailing
 * separator, lower case. "C:/Photos/" and "c:\photos" have the same key.
 */
export function pathKey(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** One path, however the two were spelled. */
export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}

/**
 * True when `p` sits under `dir`, or, with `orEqual`, is `dir` itself. The
 * separator matters, which is why this is not a `startsWith`: "C:\roots" is
 * not inside "C:\r". Empty paths are inside nothing.
 */
export function isInside(dir: string, p: string, opts: { orEqual?: boolean } = {}): boolean {
  if (!dir || !p) return false
  const d = pathKey(dir)
  const k = pathKey(p)
  return (opts.orEqual === true && k === d) || k.startsWith(d + '\\')
}

/**
 * THE VOLUME A PATH IS ON (#70, the drive rule): a plain drag moves on the
 * same volume and copies to another, Windows' way. A drive letter answers
 * "c:", a share its root "\\srv\share", both lower-cased; a place inside a
 * zip is on the zip file's drive. Anything else answers '' (callers treat
 * an unknown volume as the same one). By the path's root only: a subst
 * drive, a junction or a mounted folder can be on another volume than it
 * looks, which at worst swaps a move for a copy, both safe.
 */
export function volumeOf(p: string): string {
  const s = p.replace(/\//g, '\\')
  const drive = /^([a-z]):/i.exec(s)
  if (drive) return `${drive[1].toLowerCase()}:`
  const share = /^\\\\([^\\]+)\\([^\\]+)/.exec(s)
  return share ? `\\\\${share[1]}\\${share[2]}`.toLowerCase() : ''
}

/**
 * The one natural-order collator: "2.jpg" before "10.jpg". Hoisted, because
 * `localeCompare` with options builds a fresh collator on EVERY comparison
 * (23.3ms against 0.5ms sorting System32, 2026-08-31). Default sensitivity:
 * names that differ only by case or accent still get a fixed order.
 */
const collator = new Intl.Collator(undefined, { numeric: true })

/** Natural order of two strings. */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b)

/** Natural order of two named things, for `Array.sort`. */
export const byName = (a: { name: string }, b: { name: string }): number =>
  collator.compare(a.name, b.name)
