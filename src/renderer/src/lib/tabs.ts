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
  /** The tab's CURRENT shell - the most recently used one - if any was ever
   *  opened. `view` is only visibility - a hidden terminal keeps running.
   *  `full` replaces the viewer; `split` shares with it (the dock). Null
   *  until the first open. */
  term: { id: string; view: TermView } | null
  /** EVERY shell the tab holds, in the order opened (2026-09-03, owner: a tab
   *  can have several terminals). `term.id` is always one of these; the
   *  others run on, hidden, until picked or pinned as a pane. */
  terms: string[]
  /** Split-view pins: up to three fixed files (or terminals) beside the live pane. */
  panes: PinnedPane[]
}

/** A tree with only its root open and nothing loaded. */
export function emptyTree(root: string): TreeState {
  return { expanded: new Set([root]), children: {} }
}

/** How many remembered folders a restored tab will re-open. Past this it is
 *  not a place you were, it is a tree somebody unfolded. */
const MAX_OPEN = 400

/**
 * The tree a RESTORED tab starts with: the folders that were open when Prism
 * closed, plus every ancestor of the file it is showing.
 *
 * The ancestors matter on their own. A file can arrive from outside (argv,
 * "Open in Prism") with no saved tree at all, and the sidebar has to be able
 * to mark it - which it cannot do if the rows leading to it were never
 * expanded. Both halves land in one set, and duplicates are free.
 */
export function restoredTree(root: string, open: readonly string[] = [], file?: string): TreeState {
  const expanded = new Set<string>([root])
  for (const p of open.slice(0, MAX_OPEN)) if (p) expanded.add(p)
  if (file) for (const a of ancestorsWithin(root, file)) expanded.add(a)
  return { expanded, children: {} }
}

/** Every folder between `root` and `file`, inclusive of root, exclusive of
 *  the file itself. Case-insensitive, because Windows paths are. */
export function ancestorsWithin(root: string, file: string): string[] {
  const out: string[] = []
  const norm = (s: string): string => s.replace(/[\\/]+$/, '')
  const r = norm(root)
  let at = norm(file)
  // Walk up from the file, stopping at the root: a path outside it yields
  // nothing rather than climbing to the drive.
  for (let guard = 0; guard < 64; guard += 1) {
    const cut = Math.max(at.lastIndexOf('\\'), at.lastIndexOf('/'))
    if (cut < 0) break
    at = at.slice(0, cut)
    if (!at || at.length < r.length) break
    out.push(at)
    if (at.toLowerCase() === r.toLowerCase()) break
  }
  return out
}

/** Windows does not distinguish roots by case, so neither does a tab. */
export const sameRoot = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Is `p` somewhere inside `root`? Case-insensitive, and a trailing separator
 *  on the root is not a difference. */
export const underRoot = (root: string, p: string): boolean => {
  const r = root.toLowerCase().replace(/[\\/]+$/, '')
  const q = p.toLowerCase()
  return q.startsWith(r + '\\') || q.startsWith(r + '/')
}

/** A tab from a payload main just built. */
export function newTab(p: OpenPayload, id: string): Tab {
  return {
    id,
    root: p.root,
    files: p.files,
    index: p.files.length ? Math.max(0, Math.min(p.files.length - 1, p.index)) : -1,
    // A restored tab comes back with its folders open, and ANY tab opens the
    // folders leading to the file it is showing, so the sidebar can mark it.
    tree: restoredTree(p.root, p.open, p.files[p.index]?.path),
    term: null,
    terms: [],
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
export function toggleTermView(
  term: { id: string; view: TermView } | null,
  newId: string
): { id: string; view: TermView } {
  if (!term) return { id: newId, view: 'full' }
  return { ...term, view: term.view === 'hidden' ? 'full' : 'hidden' }
}

export function splitTermView(
  term: { id: string; view: TermView } | null,
  newId: string
): { id: string; view: TermView } {
  if (!term) return { id: newId, view: 'split' }
  return { ...term, view: term.view === 'split' ? 'hidden' : 'split' }
}

/** Write one tab's CURRENT terminal; every other tab is untouched. A shell
 *  id the tab has not seen joins its list, so every path that mints a fresh
 *  id (toggle, split, restore, reroot) keeps the list honest by construction. */
export function setTabTerm(tabs: readonly Tab[], tabId: string, term: Tab['term']): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    const terms = term && !t.terms.includes(term.id) ? [...t.terms, term.id] : t.terms
    return { ...t, term, terms }
  })
}

/**
 * The tab's terminals as a LIST (2026-09-03, owner). `term` stays the current
 * one - the most recently used, which is what the button's left click opens -
 * so everything written against "the tab's terminal" keeps meaning that.
 */

/** A fresh shell joins the list and becomes current, shown `view`. */
export function addTerm(tabs: readonly Tab[], tabId: string, id: string, view: TermView): Tab[] {
  return setTabTerm(tabs, tabId, { id, view })
}

/** Pick an existing shell: it becomes current, wearing the view the current
 *  one had (or full when nothing was showing). Unknown ids are ignored. */
export function pickTerm(tabs: readonly Tab[], tabId: string, id: string): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId || !t.terms.includes(id)) return t
    const view = t.term && t.term.view !== 'hidden' ? t.term.view : 'full'
    return { ...t, term: { id, view } }
  })
}

/** A shell is gone. If it was current, the most recently opened survivor
 *  takes over with the same view; the last one out leaves null. */
export function removeTerm(tabs: readonly Tab[], tabId: string, id: string): Tab[] {
  return tabs.map((t) => {
    if (t.id !== tabId) return t
    const terms = t.terms.filter((x) => x !== id)
    if (t.term?.id !== id) return { ...t, terms }
    const heir = terms[terms.length - 1]
    return { ...t, terms, term: heir ? { id: heir, view: t.term.view } : null }
  })
}

/** "Terminal 1", "Terminal 2"... by the order opened; the label the menus use. */
export function termLabel(tab: Pick<Tab, 'terms'>, id: string): string {
  const i = tab.terms.indexOf(id)
  return `Terminal ${i < 0 ? '?' : i + 1}`
}

/** Open the Settings tab: activate the existing one, or add it at the end. */
export function openSettingsTab(tabs: readonly Tab[], id: string): TabState {
  const existing = tabs.find((t) => t.kind === 'settings')
  if (existing) return { tabs: tabs.slice(), activeId: existing.id }
  const tab: Tab = {
    id,
    kind: 'settings',
    root: '',
    files: [],
    index: -1,
    tree: emptyTree(''),
    term: null,
    terms: [],
    panes: []
  }
  return { tabs: [...tabs, tab], activeId: id }
}

/**
 * What the gear does (2026-08-26): open settings, or bring them forward, or
 * put them away.
 *
 * The three states are what a toggle in a tab strip has to mean. Settings
 * showing: the gear closes the tab, the way pressing it again always should.
 * Settings open BEHIND something else: the gear brings it forward rather than
 * closing a tab the user cannot see - the click plainly means "show me". Not
 * open at all: open it.
 */
export function toggleSettingsTab(
  tabs: readonly Tab[],
  activeId: string | null,
  id: string
): TabState {
  const existing = tabs.find((t) => t.kind === 'settings')
  if (existing) {
    return existing.id === activeId
      ? closeTab(tabs, existing.id, activeId)
      : { tabs: tabs.slice(), activeId: existing.id }
  }
  return openSettingsTab(tabs, id)
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
  // A tab takes the file only when its root IS the file's own folder (owner,
  // 2026-09-04, reversing 2026-09-01). The containing-root fold - a file two
  // folders down landing in the tab already showing that tree - put a file
  // from Downloads into a tab rooted at the user's folder and moved that
  // tab's view, and an agent's tab is the one you least want moved under
  // you. A file from any other folder, a subfolder of an open tab included,
  // opens a tab of its own rooted at that folder: separate folders, separate
  // tabs, and one tab per root still holds.
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
  next[i] = { ...newTab(p, tabs[i].id), term: tabs[i].term, terms: tabs[i].terms }
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
