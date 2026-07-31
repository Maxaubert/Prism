import { readdirSync, realpathSync, statSync } from 'fs'
import { basename, extname, join, resolve, sep } from 'path'
import { fileKind, isViewable } from '@shared/fileKind'
import type { DirListing, ViewerFile } from '@shared/types'

// Reading directories for the sidebar tree, and the guard that keeps it inside
// the folder Prism was opened in. Main owns this: the renderer never gets to name
// a path we haven't checked.

// Windows clutter nobody wants in a viewer's tree. Dotfiles are dropped too.
const SKIP = new Set(['desktop.ini', 'thumbs.db', '$recycle.bin', 'system volume information'])

const isWin = process.platform === 'win32'

/** Resolved, symlink-free, comparable form of a path. Falls back to `resolve`
 *  when the path doesn't exist yet (realpath throws on missing entries). */
function canonical(p: string): string {
  let r: string
  try {
    r = realpathSync.native ? realpathSync.native(p) : realpathSync(p)
  } catch {
    r = resolve(p)
  }
  // Trailing separator would break the boundary check below ("C:\a\" vs "C:\a").
  if (r.length > 1 && r.endsWith(sep)) r = r.slice(0, -1)
  return isWin ? r.toLowerCase() : r
}

/**
 * True when `p` is the root or sits beneath it. Compares real paths, so a
 * symlink or junction pointing out of the root is refused, and requires a
 * separator boundary so `C:\photos-old` is not "inside" `C:\photos`.
 */
export function isInsideRoot(root: string, p: string): boolean {
  if (!root || !p) return false
  const r = canonical(root)
  const t = canonical(p)
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep)
}

/** One file as the renderer sees it. Size is 0 when it can't be stat'ed. */
export function toViewerFile(p: string): ViewerFile {
  const ext = extname(p).toLowerCase()
  let size = 0
  try {
    size = statSync(p).size
  } catch {
    /* unreadable; leave 0 so the renderer just treats it as unknown */
  }
  return { path: p, name: basename(p), ext, kind: fileKind(ext), size }
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true })

/**
 * One directory's listable contents: subfolders and the files Prism can open,
 * each group sorted naturally. Unreadable directories come back empty rather
 * than throwing, so a permission-denied folder is a dead end, not a crash.
 */
export function listDir(dir: string): DirListing {
  const folders: DirListing['folders'] = []
  const files: ViewerFile[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return { folders, files, unreadable: true }
  }
  for (const name of entries) {
    if (name.startsWith('.') || SKIP.has(name.toLowerCase())) continue
    const p = join(dir, name)
    try {
      if (statSync(p).isDirectory()) folders.push({ path: p, name })
      else if (isViewable(extname(p))) files.push(toViewerFile(p))
    } catch {
      /* vanished or unreadable between readdir and stat; skip it */
    }
  }
  return { folders: folders.sort(byName), files: files.sort(byName) }
}
