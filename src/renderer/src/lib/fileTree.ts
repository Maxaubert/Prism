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
