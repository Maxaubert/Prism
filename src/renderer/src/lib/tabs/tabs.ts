import type { OpenPayload, ViewerFile } from '@shared/types'
import type { BrowseLocation, SavedBrowse } from '@shared/browse'
import { isInside } from '@shared/path'
import {
  navigateBrowseState,
  newBrowse,
  searchBrowseState,
  travelBrowseState,
  updateBrowseLocation
} from '../browse'

/**
 * The tab list, as pure data.
 *
 * Every tab is an Explorer tab (owner, 2026-10-26: Prism is an Explorer and a
 * viewer; project tabs and their file tree are gone). A tab is a place it is
 * browsing and a current file. Not a thing you curate: close it and nothing
 * is lost but the place you were looking.
 *
 * Every branch that decides where an arriving file lands is here rather than in
 * App, because that rule is the whole feature and it is worth being able to test
 * without a window.
 */

export interface Tab {
  /** Stable for the tab's life; the React key and the id every action names. */
  id: string
  /** The one non-folder tab: the Settings page riding the strip so it can be
   *  flipped to and from like anything else. Not persisted, never confirmed
   *  on close, owns no root. */
  kind?: 'settings'
  /** Always 'explorer' for a folder tab. Kept as a field so a strip saved by an
   *  older Prism still reads (its project tabs migrate to Explorer tabs). */
  role?: 'explorer'
  /** The HOME tab: where a file or folder from outside lands. Invisible since
   *  2026-10-28 (owner: "remove the pin system for tabs every tab can be
   *  closed if you close the last it closes prism just like file explorer"):
   *  it closes, moves and is named like any tab, and closing it hands the mark
   *  to the first Explorer tab left. The field keeps its old name so saved
   *  strips read. */
  pinned?: boolean
  /** The folder the tab was opened at. Desktop browsing has its own grants. */
  root: string
  /** Folder browsing is independent of the current viewer. */
  browse: SavedBrowse
  /** The root folder's viewable files, as main listed them. */
  files: ViewerFile[]
  /** Which of `files` is on screen. -1 when the folder holds nothing viewable. */
  index: number
}

/** Windows does not distinguish roots by case, so neither does a tab. */
export const sameRoot = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Is `p` somewhere inside `root`? Case-insensitive, and a trailing separator
 *  on the root is not a difference. */
export const underRoot = (root: string, p: string): boolean => isInside(root, p)

/** A tab from a payload main just built. */
export function newTab(p: OpenPayload, id: string): Tab {
  return {
    id: p.restore && p.restoreTabId ? p.restoreTabId : id,
    role: 'explorer',
    ...(p.pinned ? { pinned: true } : {}),
    root: p.root,
    browse: p.browse ?? newBrowse(p.root, p.index < 0 ? 'folder' : 'viewer'),
    files: p.files,
    index: p.index < 0 ? -1 : p.files.length ? Math.max(0, Math.min(p.files.length - 1, p.index)) : -1
  }
}

/** Every tab but Settings is an Explorer tab; the name stays for the callers
 *  that tell the two apart. */
export const isExplorerTab = (tab: Tab): boolean => tab.kind !== 'settings'

export const isPinnedExplorer = (tab: Tab): boolean => isExplorerTab(tab) && tab.pinned === true

/** An explicit new browser never reuses or reroots an existing tab. */
export function addExplorerTab(
  tabs: readonly Tab[],
  p: OpenPayload,
  id: string,
  pinned = false
): TabState {
  const existing = pinned ? tabs.find(isPinnedExplorer) : undefined
  if (existing) return { tabs: tabs.slice(), activeId: existing.id }
  const spawned = newTab(
    { ...p, pinned, browse: p.browse ?? newBrowse(p.root) },
    id
  )
  return { tabs: pinned ? [spawned, ...tabs] : [...tabs, spawned], activeId: spawned.id }
}

/** Restore keeps every owner's identity, location and ORDER. Exactly one
 * Explorer tab carries the home mark: the marked one, else the first Explorer
 * tab, else a new one in front. Extra stale marks are cleared rather than
 * dropping tabs that may still own edited files. */
export function ensurePinnedExplorer(tabs: readonly Tab[], p: OpenPayload, id: string): Tab[] {
  const home = tabs.find(isPinnedExplorer) ?? tabs.find(isExplorerTab)
  if (!home) return addExplorerTab(tabs, p, id, true).tabs
  return tabs.map((tab) =>
    tab === home
      ? tab.pinned
        ? tab
        : { ...tab, pinned: true }
      : isPinnedExplorer(tab)
        ? { ...tab, pinned: false }
        : tab
  )
}

/**
 * A file from outside is on its way to the pinned Explorer (2026-09-22): bring
 * it to the front and, for the Preview mode,
 * the preview pane on - that is what the setting asked for, whatever the pane
 * was left as. Null when there is no pinned Explorer to bring.
 */
export function frontPinnedExplorer(tabs: readonly Tab[], preview: boolean): TabState | null {
  const pinned = tabs.find(isPinnedExplorer)
  if (!pinned) return null
  return {
    activeId: pinned.id,
    tabs: tabs.map((tab) =>
      tab === pinned
        ? {
            ...tab,
            browse: preview ? { ...tab.browse, preview: true } : tab.browse
          }
        : tab
    )
  }
}

/** Browsing a folder moves the tab's place and leaves its viewer alone. */
export function navigateBrowse(tabs: readonly Tab[], tabId: string, path: string): Tab[] {
  return tabs.map((tab) =>
    tab.id === tabId && tab.kind !== 'settings'
      ? leaveShown(tab, {
          ...tab,
          browse: navigateBrowseState(tab.browse, path, shownFile(tab))
        })
      : tab
  )
}

export function travelBrowse(tabs: readonly Tab[], tabId: string, delta: number): Tab[] {
  return tabs.map((tab) => {
    if (tab.id !== tabId || tab.kind === 'settings') return tab
    const browse = travelBrowseState(tab.browse, delta, shownFile(tab))
    return browse === tab.browse ? tab : leaveShown(tab, { ...tab, browse })
  })
}

/**
 * GOING INTO A FOLDER CLEARS THE PREVIEW (#300 review; owner, 2026-10-06, of a
 * zip opened from Downloads: the list showed its contents while the pane still
 * showed the zip's own card, "the double view"). An Explorer that moves to
 * another folder, the inside of a zip included, drops the file on display. A
 * pane that was open stays open and empty (`previewHeld`), so nothing jumps; a
 * shut one stays shut.
 * Coming back OUT of a zip shows it again (#334): `wayOutPreview`, in the hook.
 */
function leaveShown(was: Tab, tab: Tab): Tab {
  if (!isExplorerTab(was) || sameRoot(was.browse.path, tab.browse.path)) return tab
  const held = was.browse.preview && (was.index >= 0 || was.browse.previewHeld === true)
  return { ...tab, index: -1, browse: withHeld(tab.browse, held) }
}

function withHeld(browse: SavedBrowse, held: boolean): SavedBrowse {
  if (held) return { ...browse, previewHeld: true }
  if (!browse.previewHeld) return browse
  const rest = { ...browse }
  delete rest.previewHeld
  return rest
}

/** Start, refine or clear a tab's Explorer search: a search is a place in
 *  the history (#281, `searchBrowseState`). */
export function searchBrowse(tabs: readonly Tab[], tabId: string, query: string): Tab[] {
  return tabs.map((tab) => {
    if (tab.id !== tabId || tab.kind === 'settings') return tab
    const browse = searchBrowseState(tab.browse, query, shownFile(tab))
    return browse === tab.browse ? tab : { ...tab, browse }
  })
}

/** The file an Explorer tab has on display: in the preview pane (only while
 *  the pane is on) or in full view. Arriving at its folder marks it. */
function shownFile(tab: Tab): string | null {
  const file = tab.index >= 0 ? tab.files[tab.index] : undefined
  if (!file) return null
  return tab.browse.surface === 'viewer' || tab.browse.preview ? file.path : null
}

export function setBrowseLocation(
  tabs: readonly Tab[],
  tabId: string,
  patch: Partial<Omit<BrowseLocation, 'path'>>
): Tab[] {
  return tabs.map((tab) =>
    tab.id === tabId ? { ...tab, browse: updateBrowseLocation(tab.browse, patch) } : tab
  )
}

/** The history entry a scroll position was made in: its place in the history
 *  and what it showed there. */
export interface BrowseScrollAt {
  cursor: number
  path: string
  query: string
  sort: BrowseLocation['sort']
}

/**
 * A SETTLED SCROLL, HANDED UP ONCE (review, 2026-10-16). The list used to
 * patch the tab on every native scroll event, which re-rendered the whole App
 * and re-sorted the folder per frame, and sent every tab's history to main.
 * The list now scrolls on its own and hands the position up when it settles,
 * which can be after a navigation, so it lands on the entry it was MADE in
 * (`at`), never on whatever is current. An entry that has since changed what
 * it shows (a refined search, a new sort) keeps its own position. Nothing to
 * change answers the same array, so the setState does nothing.
 */
export function setBrowseScroll(
  tabs: Tab[],
  tabId: string,
  at: BrowseScrollAt,
  scrollTop: number
): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId)
  const tab = tabs[index]
  if (!tab || tab.kind === 'settings') return tabs
  const entry = tab.browse.history[at.cursor]
  if (
    !entry ||
    entry.scrollTop === scrollTop ||
    entry.path !== at.path ||
    entry.query !== at.query ||
    entry.sort.key !== at.sort.key ||
    entry.sort.direction !== at.sort.direction
  )
    return tabs
  const history = tab.browse.history.slice()
  history[at.cursor] = { ...entry, scrollTop }
  const next = tabs.slice()
  next[index] = { ...tab, browse: { ...tab.browse, history } }
  return next
}

/**
 * The place on screen turned out to be another (#300: a folder gone from
 * inside a zip answers the nearest one still there). The CURRENT history
 * entry is rewritten, never a new one pushed: pushing made Back land on the
 * gone folder again, which redirected forward again, so Back never got past it.
 */
export function replaceBrowsePath(tabs: readonly Tab[], tabId: string, path: string): Tab[] {
  return tabs.map((tab) => {
    if (tab.id !== tabId || tab.kind === 'settings') return tab
    const history = tab.browse.history.slice()
    const here = history[tab.browse.cursor]
    if (!here) return tab
    history[tab.browse.cursor] = { ...here, path, selected: null, scrollTop: 0 }
    return { ...tab, browse: { ...tab.browse, history, path } }
  })
}

export function setBrowseSurface(
  tabs: readonly Tab[],
  tabId: string,
  surface: SavedBrowse['surface']
): Tab[] {
  return tabs.map((tab) =>
    tab.id === tabId ? { ...tab, browse: { ...tab.browse, surface } } : tab
  )
}

export function setBrowsePreview(tabs: readonly Tab[], tabId: string, preview: boolean): Tab[] {
  return tabs.map((tab) =>
    // A pane put away forgets that it was held open empty.
    tab.id === tabId
      ? { ...tab, browse: withHeld({ ...tab.browse, preview }, preview && !!tab.browse.previewHeld) }
      : tab
  )
}

/** Open the Settings tab: activate the existing one, or add it at the end. */
export function openSettingsTab(tabs: readonly Tab[], id: string): TabState {
  const existing = tabs.find((t) => t.kind === 'settings')
  if (existing) return { tabs: tabs.slice(), activeId: existing.id }
  const tab: Tab = {
    id,
    kind: 'settings',
    root: '',
    browse: newBrowse(''),
    files: [],
    index: -1
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

/**
 * Would putting Settings away leave no tab at all (review, 2026-10-28)? Then
 * the window closes instead, as on any other last tab (owner, 2026-10-28: "if
 * you close the last it closes prism just like file explorer"); the gear and
 * Settings' own close used to leave an empty window behind. `toggle` is the
 * gear, which closes Settings only when it is the tab in view.
 */
export function settingsCloseIsLast(
  tabs: readonly Tab[],
  activeId: string | null,
  toggle: boolean
): boolean {
  if (tabs.length !== 1 || tabs[0].kind !== 'settings') return false
  return !toggle || tabs[0].id === activeId
}

/**
 * Does Escape on Settings put the page away? Only when another tab is left:
 * ESCAPE NEVER CLOSES THE WINDOW (#14, owner, 2026-11-01: "escape should not
 * interact with app close"). As the last tab Settings stays, and the window
 * goes only by its X, the tab's X or Ctrl+W.
 */
export function settingsEscapeCloses(tabs: readonly Tab[]): boolean {
  return tabs.some((t) => t.kind === 'settings') && tabs.length > 1
}

export interface TabState {
  tabs: Tab[]
  activeId: string | null
}

/**
 * Add a tab, unconditionally.
 *
 * The strip's `+` is an explicit "give me a tab", not "show me this file":
 * pressing + and watching nothing happen is worse than two tabs on one folder.
 */
export function addTab(tabs: readonly Tab[], p: OpenPayload, id: string): TabState {
  const spawned = newTab(p, id)
  return { tabs: [...tabs, spawned], activeId: spawned.id }
}

/**
 * A RESTORED tab goes back to its SAVED place (#271). Main sends the Explorer
 * tabs first and every other tab as soon as it is ready, so payloads arrive
 * out of order; each carries `restoreOrder`, and it is put before the first
 * tab already restored with a later one. A tab with no order (a file handed
 * over at launch, a tab made meanwhile) is never moved past.
 */
export function addRestoredTab(
  tabs: readonly Tab[],
  p: OpenPayload,
  id: string,
  orderOf: (tabId: string) => number | undefined
): TabState {
  const spawned = newTab(p, id)
  const order = p.restoreOrder
  if (order === undefined) return { tabs: [...tabs, spawned], activeId: spawned.id }
  const at = tabs.findIndex((t) => {
    const o = orderOf(t.id)
    return o !== undefined && o > order
  })
  const next = tabs.slice()
  if (at < 0) next.push(spawned)
  else next.splice(at, 0, spawned)
  return { tabs: next, activeId: spawned.id }
}

/**
 * Close one tab, any tab (2026-10-28). The active mark goes to the right-hand
 * neighbour, then the left, then nowhere; the caller closes the window when
 * none is left. Closing the home tab hands its mark to the first Explorer tab
 * left, so a file from outside still has somewhere to land.
 */
export function closeTab(tabs: readonly Tab[], id: string, activeId: string | null): TabState {
  const i = tabs.findIndex((t) => t.id === id)
  if (i < 0) return { tabs: tabs.slice(), activeId }
  let next = tabs.filter((t) => t.id !== id)
  if (isPinnedExplorer(tabs[i])) {
    const heirHome = next.find(isExplorerTab)
    if (heirHome) next = next.map((t) => (t === heirHome ? { ...t, pinned: true } : t))
  }
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
function parentName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : ''
}

/**
 * What each tab is called: the root's basename, and the parent's name added
 * only where two tabs would otherwise read the same. Two `assets` folders are
 * genuinely ambiguous; every other tab keeps the short label it deserves.
 *
 * A drive root has no basename, so it keeps its whole path. The home tab is
 * named the same way: the folder it is in, never "Explorer" (owner, 2026-10-28:
 * "tab should show the current folder name").
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
  // was aimed past its old home has to come back by one too. Every tab moves,
  // the home tab included (2026-10-28).
  const at = Math.max(0, Math.min(toIndex > from ? toIndex - 1 : toIndex, next.length))
  next.splice(at, 0, moved)
  return next
}

export function tabLabels(tabs: readonly Tab[]): string[] {
  const paths = tabs.map((t) => t.browse.path)
  const bases = tabs.map((t, i) => (t.kind === 'settings' ? 'Settings' : baseOf(paths[i])))
  // A collision means one basename over DIFFERENT roots. Two tabs on the very
  // same folder (the + allows that) have nothing to tell apart, so they keep
  // the plain name rather than both growing an identical suffix.
  const rootsByBase = new Map<string, Set<string>>()
  tabs.forEach((_, i) => {
    const set = rootsByBase.get(bases[i]) ?? new Set<string>()
    set.add(paths[i].toLowerCase())
    rootsByBase.set(bases[i], set)
  })
  return tabs.map((_, i) => {
    const b = bases[i]
    if (!b) return paths[i]
    if ((rootsByBase.get(b)?.size ?? 0) < 2) return b
    const parent = parentName(paths[i])
    return parent ? `${b} — ${parent}` : b
  })
}
