// Pure path and expansion helpers for the sidebar tree. The renderer has no
// `path` module, so this does the small amount of splitting it needs, tolerating
// either separator. Everything here is a plain function: no React, no IPC.

const SEP = /[\\/]/

/** Case-insensitive comparison, since Windows paths are. */
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Everything before the last separator: "C:\a\b.jpg" -> "C:\a". */
export function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i <= 0 ? '' : p.slice(0, i)
}

/**
 * The folders to open so `path` is visible: the root first, then each folder
 * down to (and including) the one holding it. Empty when `path` is not inside
 * the root, which is also how a path in a same-prefixed sibling is rejected.
 */
export function ancestorChain(root: string, path: string): string[] {
  if (!root || !path) return []
  const rootParts = root.split(SEP).filter(Boolean)
  const parts = path.split(SEP).filter(Boolean)
  if (parts.length <= rootParts.length) return []
  if (!rootParts.every((seg, i) => same(seg, parts[i]))) return []

  const chain = [root]
  const sep = root.includes('\\') ? '\\' : '/'
  // Stop before the last segment: that's the file itself, not a folder to open.
  for (let i = rootParts.length; i < parts.length - 1; i += 1) {
    chain.push(chain[chain.length - 1] + sep + parts[i])
  }
  return chain
}

/** The expanded set with `path` flipped; the input set is left untouched. */
export function toggleExpanded(expanded: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(expanded)
  if (!next.delete(path)) next.add(path)
  return next
}

/* ---------- the keyboard's view of the tree ---------- */

/** One navigable row, in the order the tree draws it. */
export interface TreeRow {
  path: string
  name: string
  isFolder: boolean
}

/**
 * Every row the tree is currently showing, flattened depth-first: the cursor
 * walks this. The order has to match what `Rows` renders exactly - folders
 * before files, the filter applied to files only, the sort applied to both -
 * or the arrows would land somewhere other than the highlight suggests. The
 * ordering itself is passed in rather than imported, so this stays a pure
 * function of its arguments and the sort store keeps its single owner.
 *
 * A folder that is expanded but whose children haven't loaded yet contributes
 * only itself, which is exactly what is on screen at that moment.
 */
export function visibleRows<F extends FileEntry>(
  root: string,
  expanded: ReadonlySet<string>,
  children: Readonly<
    Record<string, { folders: ReadonlyArray<FileEntry>; files: readonly F[]; unreadable?: boolean }>
  >,
  opts: {
    orderFiles: (files: F[]) => readonly F[]
    /** Folders follow the sort direction only when the field is name. */
    foldersReversed: boolean
  }
): TreeRow[] {
  const out: TreeRow[] = []
  const seen = new Set<string>() // a symlink loop must not hang the keyboard
  const walk = (dir: string): void => {
    if (seen.has(dir.toLowerCase())) return
    seen.add(dir.toLowerCase())
    const listing = children[dir]
    if (!listing || listing.unreadable) return
    const folders = opts.foldersReversed ? [...listing.folders].reverse() : listing.folders
    for (const f of folders) {
      out.push({ path: f.path, name: f.name, isFolder: true })
      if (expanded.has(f.path)) walk(f.path)
    }
    for (const f of opts.orderFiles([...listing.files])) {
      out.push({ path: f.path, name: f.name, isFolder: false })
    }
  }
  walk(root)
  return out
}

/** Only what visibleRows needs of a row, so this module stays type-light. */
interface FileEntry {
  path: string
  name: string
}

/**
 * The row the cursor lands on when it steps `delta` from `from`.
 *
 * `filesOnly` is what makes Left/Right keep meaning "previous / next file"
 * while Up/Down mean "previous / next row": the same cursor, two strides.
 * Returns null at the ends, so the caller can leave the cursor where it is
 * rather than wrapping around a folder the user is reading through.
 */
export function stepRow(
  rows: readonly TreeRow[],
  from: string | null,
  delta: number,
  filesOnly = false
): TreeRow | null {
  if (!rows.length) return null
  const at = from ? rows.findIndex((r) => same(r.path, from)) : -1
  // Nothing selected yet: step in from the near end rather than refusing.
  let i = at < 0 ? (delta > 0 ? -1 : rows.length) : at
  for (;;) {
    i += delta > 0 ? 1 : -1
    if (i < 0 || i >= rows.length) return null
    if (!filesOnly || !rows[i].isFolder) return rows[i]
  }
}
