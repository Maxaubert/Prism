/**
 * The phone browser's arithmetic (2026-09-06, #104), pure: where "up" goes,
 * what the crumb row says, and which file is next. Paths are Windows paths
 * handed over by the PC, compared without case, and the root is a wall here
 * as it is in main: nothing walks above it.
 */
import type { ViewerFile } from '@shared/types'

const trim = (p: string): string => p.replace(/[\\/]+$/, '')
const same = (a: string, b: string): boolean => trim(a).toLowerCase() === trim(b).toLowerCase()

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

/** The file after (or before) `current` in the folder's own order; null at
 *  either end, and null when `current` is not in the list at all. */
export function stepFile(files: ViewerFile[], current: string, dir: 1 | -1): ViewerFile | null {
  const i = files.findIndex((f) => f.path === current)
  if (i < 0) return null
  return files[i + dir] ?? null
}
