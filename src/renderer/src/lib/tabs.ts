import type { DirListing, OpenPayload, ViewerFile } from '@shared/types'
import type { PinnedPane } from './panes'

export type TermView = 'hidden' | 'full' | 'split'

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
  /** The one non-folder tab: the Settings page riding the strip so it can be
   *  flipped to and from like anything else. Not persisted, never confirmed
   *  on close, owns no root. */
  kind?: 'settings'
  /** Absolute. The folder the tree is bounded by and main checks against. */
  root: string
  /** The root folder's viewable files, as main listed them. */
  files: ViewerFile[]
  /** Which of `files` is on screen. -1 when the folder holds nothing viewable. */
  index: number
  tree: TreeState
  /** The tab's shell, if one was ever opened. `view` is only visibility - a
   *  hidden terminal keeps running. `full` replaces the viewer; `split` shares
   *  with it (the dock). Null until the first open. */
  term: { id: string; view: TermView } | null
  /** Split-view pins: up to three fixed files beside the live pane. */
  panes: PinnedPane[]
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
    tree: emptyTree(p.root),
    term: null,
    panes: []
  }
}

/** Write one tab's pinned panes; every other tab is untouched. */
export function setTabPanes(tabs: readonly Tab[], tabId: string, panes: PinnedPane[]): Tab[] {
  return tabs.map((t) => (t.id === tabId ? { ...t, panes } : t))
}

/**
 * The visibility transitions, pure so they can be tested:
 *   - toggle (`Ctrl+\``, the sidebar button): anything visible hides; hidden
 *     or absent opens FULL. Full view is the terminal's home; split is the
 *     deliberate arrangement.
 *   - split (`Ctrl+D`, the context menu): a file on screen gains the terminal
 *     beside it; already split folds back to the file alone.
 * `wantTerm` returns what the tab's term should become; the caller supplies
 * the id for a shell that does not exist yet.
 */
export function toggleTermView(term: { id: string; view: TermView } | null, newId: string): { id: string; view: TermView } {
  if (!term) return { id: newId, view: 'full' }
  return { ...term, view: term.view === 'hidden' ? 'full' : 'hidden' }
}

export function splitTermView(term: { id: string; view: TermView } | null, newId: string): { id: string; view: TermView } {
  if (!term) return { id: newId, view: 'split' }
  return { ...term, view: term.view === 'split' ? 'hidden' : 'split' }
}

/** Write one tab's terminal slot; every other tab is untouched. */
export function setTabTerm(
  tabs: readonly Tab[],
  tabId: string,
  term: Tab['term']
): Tab[] {
  return tabs.map((t) => (t.id === tabId ? { ...t, term } : t))
}

/** Open the Settings tab: activate the existing one, or add it at the end. */
export function openSettingsTab(tabs: readonly Tab[], id: string): TabState {
  const existing = tabs.find((t) => t.kind === 'settings')
  if (existing) return { tabs: tabs.slice(), activeId: existing.id }
  const tab: Tab = { id, kind: 'settings', root: '', files: [], index: -1, tree: emptyTree(''), term: null, panes: [] }
  return { tabs: [...tabs, tab], activeId: id }
}

export interface TabState {
  tabs: Tab[]
  activeId: string | null
}

/**
 * Add a tab, unconditionally.
 *
 * The strip's `+` is an explicit "give me a tab", not "show me this file", so
 * unlike `receiveFile` it does NOT fold into a tab that already has that root:
 * pressing + and watching nothing happen is worse than two tabs on one folder.
 * Arriving files still land in the first tab matching their root, so nothing
 * downstream has to care that two can exist.
 */
export function addTab(tabs: readonly Tab[], p: OpenPayload, id: string): TabState {
  const spawned = newTab(p, id)
  return { tabs: [...tabs, spawned], activeId: spawned.id }
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
  const hit = tabs.findIndex((t) => t.kind !== 'settings' && sameRoot(t.root, p.root))
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
  return addTab(tabs, p, id)
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
  // The shell survives the move: killing a dev server because the tree changed
  // folders would be worse. Its cwd is visibly the old one; exit + reopen gets
  // the new root. Everything else (files, index, tree) starts fresh.
  next[i] = { ...newTab(p, tabs[i].id), term: tabs[i].term }
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
/**
 * Move a tab to another slot in the strip (#70, dragged by its own row).
 * `toIndex` is the slot in the CURRENT list the tab should land in front of;
 * dropping past the end appends. Pure, so the strip's drag maths is testable.
 */
export function reorderTabs(tabs: readonly Tab[], id: string, toIndex: number): Tab[] {
  const from = tabs.findIndex((t) => t.id === id)
  if (from < 0) return [...tabs]
  const next = [...tabs]
  const [moved] = next.splice(from, 1)
  // Removing the tab shifts everything after it left by one, so a drop that
  // was aimed past its old home has to come back by one too.
  const at = Math.max(0, Math.min(toIndex > from ? toIndex - 1 : toIndex, next.length))
  next.splice(at, 0, moved)
  return next
}

export function tabLabels(tabs: readonly Tab[]): string[] {
  const bases = tabs.map((t) => (t.kind === 'settings' ? 'Settings' : baseOf(t.root)))
  // A collision means one basename over DIFFERENT roots. Two tabs on the very
  // same folder (the + allows that) have nothing to tell apart, so they keep
  // the plain name rather than both growing an identical suffix.
  const rootsByBase = new Map<string, Set<string>>()
  tabs.forEach((t, i) => {
    const set = rootsByBase.get(bases[i]) ?? new Set<string>()
    set.add(t.root.toLowerCase())
    rootsByBase.set(bases[i], set)
  })
  return tabs.map((t, i) => {
    const b = bases[i]
    if (!b) return t.root
    if ((rootsByBase.get(b)?.size ?? 0) < 2) return b
    const parent = parentOf(t.root)
    return parent ? `${b} — ${parent}` : b
  })
}
