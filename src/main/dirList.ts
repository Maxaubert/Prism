import { readdirSync, realpathSync, statSync } from 'fs'
import { basename, extname, join, resolve, sep } from 'path'
import { fileKind, isViewable } from '@shared/fileKind'
import type { DirListing, SearchHit, SearchResult, ViewerFile } from '@shared/types'

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

/** True when `p` is the root itself, which nothing is allowed to rename or bin. */
export function isRoot(root: string, p: string): boolean {
  return !!root && !!p && canonical(root) === canonical(p)
}

/** One file as the renderer sees it. Size is 0 when it can't be stat'ed. */
export function toViewerFile(p: string): ViewerFile {
  const ext = extname(p).toLowerCase()
  let size = 0
  let mtimeMs = 0
  try {
    const st = statSync(p)
    size = st.size
    mtimeMs = st.mtimeMs
  } catch {
    /* unreadable; leave 0 so the renderer just treats it as unknown */
  }
  const name = basename(p)
  return { path: p, name, ext, kind: fileKind(ext, name), size, mtimeMs }
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true })

/**
 * Every viewable file under `root` whose name contains `query`, breadth-first
 * so shallow matches come before deep ones. Bounded twice over - matches
 * returned and directory entries scanned - because "the folder Prism opened
 * in" can be a network share with a million files, and a search must never
 * become a hang.
 */
export function searchFiles(root: string, query: string, maxHits = 200, maxEntries = 20000): SearchResult {
  const q = query.trim().toLowerCase()
  const hits: SearchHit[] = []
  if (!q) return { hits, truncated: false }

  let scanned = 0
  const queue: string[] = [root]
  while (queue.length) {
    const dir = queue.shift()!
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue // unreadable folder: a dead end, not a crash
    }
    for (const e of entries) {
      if (++scanned > maxEntries) return { hits, truncated: true }
      const name = e.name
      if (name.startsWith('.') || SKIP.has(name.toLowerCase())) continue
      if (e.isDirectory()) {
        queue.push(join(dir, name))
        continue
      }
      const ext = extname(name)
      if (!isViewable(ext, name)) continue
      if (!name.toLowerCase().includes(q)) continue
      const rel = dir.slice(root.length).replace(/^[\\/]/, '')
      hits.push({ path: join(dir, name), name, kind: fileKind(ext.toLowerCase(), name), dir: rel })
      if (hits.length >= maxHits) return { hits, truncated: true }
    }
  }
  return { hits, truncated: false }
}

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
      else if (isViewable(extname(p), name)) files.push(toViewerFile(p))
    } catch {
      /* vanished or unreadable between readdir and stat; skip it */
    }
  }
  return { folders: folders.sort(byName), files: files.sort(byName) }
}
