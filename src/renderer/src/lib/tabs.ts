import type { DirListing, OpenPayload, ViewerFile } from '@shared/types'

/**
 * The tab list, as pure data.
 *
 * A tab is a root and a current file. Not a project with settings, not a thing
 * you curate: close it and nothing is lost but the place you were looking.
 *
 * Every branch that decides where an arriving file lands is here rather than in
 * App, because that rule is the whole feature and it is worth being able to test
 * without a window.
 */

/** The sidebar tree's state, lifted out of Sidebar so it belongs to the tab.
 *  Left inside the component it reset on every switch, which made a tab feel
 *  like a reload rather than a place you left. */
export interface TreeState {
  expanded: Set<string>
  /** path -> its children, once loaded. Absent means "not loaded yet". */
  children: Record<string, DirListing>
}

export interface Tab {
  /** Stable for the tab's life; the React key and the id every action names. */
  id: string
  /** Absolute. The folder the tree is bounded by and main checks against. */
  root: string
  /** The root folder's viewable files, as main listed them. */
  files: ViewerFile[]
  /** Which of `files` is on screen. -1 when the folder holds nothing viewable. */
  index: number
  tree: TreeState
}

/** A tree with only its root open and nothing loaded. */
export function emptyTree(root: string): TreeState {
  return { expanded: new Set([root]), children: {} }
}

/** Windows does not distinguish roots by case, so neither does a tab. */
export const sameRoot = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** A tab from a payload main just built. */
export function newTab(p: OpenPayload, id: string): Tab {
  return {
    id,
    root: p.root,
    files: p.files,
    index: p.files.length ? Math.max(0, Math.min(p.files.length - 1, p.index)) : -1,
    tree: emptyTree(p.root)
  }
}

export interface TabState {
  tabs: Tab[]
  activeId: string | null
}

/**
 * Where a file arriving from outside lands. One rule, three outcomes:
 *
 *   1. A tab whose root already holds it: switch to that tab and point it at
 *      the file. Quick-looking through a folder never breeds duplicate tabs.
 *   2. Otherwise, with tabs already open: a new tab.
 *   3. Otherwise: fill the empty window.
 *
 * The reused tab takes the fresh file list too, so a sibling renamed since it
 * was opened is not stale, but keeps its expanded folders: it is a place you
 * left, not a reload.
 */
export function receiveFile(tabs: readonly Tab[], p: OpenPayload, id: string): TabState {
  const hit = tabs.findIndex((t) => sameRoot(t.root, p.root))
  if (hit >= 0) {
    const next = tabs.slice()
    const was = next[hit]
    next[hit] = {
      ...was,
      files: p.files,
      index: p.files.length ? Math.max(0, Math.min(p.files.length - 1, p.index)) : -1
    }
    return { tabs: next, activeId: was.id }
  }
  const spawned = newTab(p, id)
  return { tabs: [...tabs, spawned], activeId: spawned.id }
}

/**
 * Point one tab at a different folder, in place.
 *
 * This is what the sidebar's folder button does, as against the strip's `+`:
 * the tab you are in becomes that folder, keeping its id and its place in the
 * strip, so "open a folder" is a move rather than an accumulation. The tree
 * starts fresh, because the folders the old root had open mean nothing here.
 *
 * If another tab is already that folder, it wins: switching to it keeps one tab
 * per root, which is the invariant `receiveFile` leans on to know that a file
 * arriving from outside has a home. Rerooting a tab onto its own root is then
 * naturally a no-op you simply stay on.
 */
export function rerootTab(
  tabs: readonly Tab[],
  id: string | null,
  p: OpenPayload,
  newId: string
): TabState {
  const already = tabs.find((t) => sameRoot(t.root, p.root))
  if (already) return { tabs: tabs.slice(), activeId: already.id }
  const i = tabs.findIndex((t) => t.id === id)
  if (i < 0) return receiveFile(tabs, p, newId)
  const next = tabs.slice()
  next[i] = { ...newTab(p, tabs[i].id) }
  return { tabs: next, activeId: tabs[i].id }
}

/**
 * Close one tab. The active mark goes to the right-hand neighbour, then the
 * left, then nowhere: closing the last tab leaves an empty window rather than
 * taking the window with it.
 */
export function closeTab(tabs: readonly Tab[], id: string, activeId: string | null): TabState {
  const i = tabs.findIndex((t) => t.id === id)
  if (i < 0) return { tabs: tabs.slice(), activeId }
  const next = tabs.filter((t) => t.id !== id)
  if (activeId !== id) return { tabs: next, activeId }
  const heir = next[i] ?? next[i - 1] ?? null
  return { tabs: next, activeId: heir?.id ?? null }
}

/** The basename of a path, with no trailing separator. Empty at a drive root. */
function baseOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

/** The parent folder's name, for disambiguating a collision. */
function parentOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : ''
}

/**
 * What each tab is called: the root's basename, and the parent's name added
 * only where two tabs would otherwise read the same. Two `assets` folders are
 * genuinely ambiguous; every other tab keeps the short label it deserves.
 *
 * A drive root has no basename, so it keeps its whole path.
 */
export function tabLabels(tabs: readonly Tab[]): string[] {
  const bases = tabs.map((t) => baseOf(t.root))
  const seen = new Map<string, number>()
  bases.forEach((b) => seen.set(b, (seen.get(b) ?? 0) + 1))
  return tabs.map((t, i) => {
    const b = bases[i]
    if (!b) return t.root
    if ((seen.get(b) ?? 0) < 2) return b
    const parent = parentOf(t.root)
    return parent ? `${b} — ${parent}` : b
  })
}
