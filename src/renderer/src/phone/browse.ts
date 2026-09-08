/**
 * The phone browser's arithmetic (2026-09-06, #104), pure: where "up" goes,
 * what the crumb row says, and which file is next. Paths are Windows paths
 * handed over by the PC, compared without case, and the root is a wall here
 * as it is in main: nothing walks above it.
 */
import type { SearchHit, ViewerFile } from '@shared/types'

const trim = (p: string): string => p.replace(/[\\/]+$/, '')
const same = (a: string, b: string): boolean => trim(a).toLowerCase() === trim(b).toLowerCase()

/** One folder, however the two were spelled: case and a trailing separator do
 *  not make two folders, on Windows or in the wall main keeps. */
export const samePath = same

/**
 * True when `p` is the root or sits under it - the renderer's reading of the
 * check main makes on every phone route (`isInsideRoot`), for the one thing
 * the page decides for itself: whether a place it has been handed belongs to
 * the root it is on. The separator matters and is why this is not a
 * `startsWith`: "C:\roots" is not inside "C:\r".
 */
export function insideRoot(root: string, p: string): boolean {
  if (!root || !p) return false
  const r = trim(root).toLowerCase()
  const t = trim(p).toLowerCase()
  return t === r || t.startsWith(`${r}\\`)
}

/** The folder above `dir`, or null at the root. Returns `root` itself, as
 *  spelled, when the parent IS the root, so the caller's state stays equal to
 *  what it was given. */
export function parentOf(root: string, dir: string): string | null {
  if (same(dir, root)) return null
  const d = trim(dir)
  const i = d.lastIndexOf('\\')
  if (i <= 0) return null
  const up = d.slice(0, i)
  return same(up, root) ? root : up
}

/** The path from the root folder's own name down to `dir`, one crumb each. */
export function crumbs(root: string, dir: string): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = []
  let at: string | null = dir
  while (at) {
    const t = trim(at)
    out.unshift({ name: t.slice(t.lastIndexOf('\\') + 1) || t, path: t })
    at = parentOf(root, at)
  }
  return out
}

/**
 * A search hit as the file a row hands the viewer. A hit carries a path, a
 * name and a kind, which is everything the viewers read; the SIZE it does not
 * carry is left at 0 rather than fetched, because the one place a size shows
 * is the archive header's "N compressed", which omits the clause when there
 * is none. The extension is lower-cased, as `toViewerFile` does, so the
 * icon's chip and the kind tests read the same on both hosts.
 */
export function fileFromHit(hit: SearchHit): ViewerFile {
  const dot = hit.name.lastIndexOf('.')
  return {
    path: hit.path,
    name: hit.name,
    ext: dot > 0 ? hit.name.slice(dot).toLowerCase() : '',
    kind: hit.kind,
    size: 0,
    mtimeMs: 0
  }
}

/** The file after (or before) `current` in the folder's own order; null at
 *  either end, and null when `current` is not in the list at all. */
export function stepFile(files: ViewerFile[], current: string, dir: 1 | -1): ViewerFile | null {
  const i = files.findIndex((f) => f.path === current)
  if (i < 0) return null
  return files[i + dir] ?? null
}
