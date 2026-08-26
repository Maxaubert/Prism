// The folders Prism has been opened in, most recent first (2026-08-23). The
// tab strip's `+` offers the last few on a right-click, so reopening a project
// does not mean walking a chooser to it again.
//
// History, not a curated list: closing a tab does not forget its folder, and
// nothing here is a favourite. A folder seen again simply moves to the front.

const KEY = 'prism.recentRoots'
/** Kept in storage. More than the menu shows, so a folder that falls off the
 *  visible five can still come back when the ones above it are revisited. */
const CAP = 12

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** The list after seeing `path`: it goes to the front, once. Pure. */
export function withRoot(list: readonly string[], path: string): string[] {
  const p = path.trim()
  if (!p) return [...list]
  return [p, ...list.filter((x) => !same(x, p))].slice(0, CAP)
}

/** The last segment of a path, whichever separator it uses. */
const baseName = (p: string): string => /[^\\/]*$/.exec(p.replace(/[\\/]+$/, ''))?.[0] ?? p

/**
 * What to call each folder in the menu. Two folders can share a name
 * (`site/src` and `app/src`), and a menu of identical rows is useless, so a
 * repeated name takes its parent along. Pure, and the reason this is here
 * rather than inline in the strip.
 */
export function recentLabels(paths: readonly string[]): Array<{ path: string; label: string }> {
  const counts = new Map<string, number>()
  for (const p of paths) {
    const k = baseName(p).toLowerCase()
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return paths.map((p) => {
    const name = baseName(p)
    if ((counts.get(name.toLowerCase()) ?? 0) < 2) return { path: p, label: name }
    const parent = baseName(p.replace(/[\\/][^\\/]*$/, ''))
    return { path: p, label: parent ? `${name}  ·  ${parent}` : name }
  })
}

export function recentRoots(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x) : []
  } catch {
    return []
  }
}

export function rememberRoot(path: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(withRoot(recentRoots(), path)))
  } catch {
    /* no storage: the menu is simply empty this session */
  }
}

/** Drop one, for a folder that turned out to be gone. */
export function forgetRoot(path: string): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(recentRoots().filter((x) => !same(x, path)))
    )
  } catch {
    /* nothing to do */
  }
}
