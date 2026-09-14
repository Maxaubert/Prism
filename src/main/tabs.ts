import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'
import type { BrowseLocation, SavedBrowse, SavedPane } from '@shared/browse'

/**
 * The tab strip, across restarts.
 *
 * Modelled on window-state.json and for the same reasons: a small file in
 * userData, written on a debounce, and treated as a suggestion rather than as
 * truth. A root you deleted last week is dropped without a word - a viewer that
 * opens with an error dialog about a folder that is gone is worse than one that
 * quietly opens with one tab fewer.
 *
 * Roots are absolute paths on one machine. Nothing here is portable and nothing
 * here is precious: losing the file costs you the strip, not any work.
 */

export interface SavedTab {
  id?: string
  browse?: SavedBrowse
  panes?: SavedPane[]
  root: string
  /** The file that tab was showing. Absent if it was showing none. */
  file?: string
  /** The terminal was showing, in this view. The shell itself dies with the
   *  app; this remembers only that the tab should come back AS a terminal. */
  term?: 'full' | 'split' | 'hidden'
  /** How many shells the tab held (2026-09-03): a tab with three comes back
   *  with three slots, the current one spawned and the rest spawned when
   *  picked. Absent or 1 means the one `term` describes. */
  terms?: number
  /** The shell's own existing absolute folder. Browsing and shell location
   * are independent; restoring a shell never moves the phone's shared root. */
  cwd?: string
  /** The shell hosted a CLAUDE session when the strip was saved: restore may
   *  resume it (`claude --continue` rebuilds the conversation per folder). */
  /** Which agent the shell hosted at quit, so the right resume runs. The
   *  legacy `true` from before codex could resume means claude. */
  agent?: 'claude' | 'codex'
  /**
   * The folders that were OPEN in this tab's tree.
   *
   * A tab is a root and a current file (2026-08-20), and this is deliberately
   * not a per-tab SETTING - it is where you had got to. Closing Prism used to
   * collapse the whole tree, so reopening on a file six folders down showed it
   * in the viewer with nothing marked in the sidebar, because none of the rows
   * leading to it existed yet.
   *
   * Capped, because it is a suggestion and not a record: a tree somebody has
   * opened a thousand folders in is not worth carrying, and the ancestors of
   * the current file are re-derived on restore regardless.
   */
  open?: string[]
}

export interface SavedTabs {
  tabs: SavedTab[]
  /** Index into `tabs` of the one that was in front. */
  active: number
}

const NONE: SavedTabs = { tabs: [], active: 0 }

/** Is `p` the folder `root` or somewhere inside it? Lower-cased first, since
 *  these are Windows paths and two spellings are one folder; `relative` is a
 *  plain string comparison and would call C:\Foo and C:\foo strangers. */
const inside = (root: string, p: string): boolean => {
  const rel = relative(resolve(root.toLowerCase()), resolve(p.toLowerCase()))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const isFolder = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** History is a bounded suggestion. Each surviving location keeps its own view. */
export function parseBrowse(raw: unknown): SavedBrowse | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Partial<SavedBrowse>
  if (typeof value.path !== 'string' || !isAbsolute(value.path) || !isFolder(value.path))
    return undefined
  const history: BrowseLocation[] = []
  let cursor = 0
  const entries = Array.isArray(value.history) ? value.history.slice(0, 100) : []
  entries.forEach((location, index) => {
    if (
      !location ||
      typeof location !== 'object' ||
      typeof location.path !== 'string' ||
      !isAbsolute(location.path) ||
      !isFolder(location.path)
    )
      return
    if (index === value.cursor) cursor = history.length
    history.push({
      path: location.path,
      selected: typeof location.selected === 'string' ? location.selected : null,
      scrollTop:
        typeof location.scrollTop === 'number' && Number.isFinite(location.scrollTop)
          ? Math.max(0, location.scrollTop)
          : 0,
      query: typeof location.query === 'string' ? location.query.slice(0, 1000) : '',
      sort: {
        key: ['name', 'type', 'size', 'modified'].includes(location.sort?.key)
          ? location.sort.key
          : 'name',
        direction: location.sort?.direction === 'desc' ? 'desc' : 'asc'
      }
    })
  })
  if (!history.length)
    history.push({
      path: value.path,
      selected: null,
      scrollTop: 0,
      query: '',
      sort: { key: 'name', direction: 'asc' }
    })
  if (history[cursor].path !== value.path) {
    const found = history.findIndex((entry) => entry.path === value.path)
    if (found >= 0) cursor = found
    else {
      cursor = history.length
      history.push({
        path: value.path,
        selected: null,
        scrollTop: 0,
        query: '',
        sort: { key: 'name', direction: 'asc' }
      })
    }
  }
  return {
    path: value.path,
    history,
    cursor,
    surface: value.surface === 'viewer' ? 'viewer' : 'folder',
    preview: value.preview === true
  }
}

/**
 * Read a saved strip out of JSON, keeping only what still exists.
 *
 * Pure and separate from the file system read so it can be tested: everything
 * interesting here is the filtering, not the reading. A root that is gone (or
 * has become a file) takes its tab with it, and the active index follows the
 * tab it named rather than staying on a number that now means someone else.
 */
export function parseTabs(raw: string): SavedTabs {
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return NONE
  }
  if (!doc || typeof doc !== 'object') return NONE
  const list = (doc as { tabs?: unknown }).tabs
  if (!Array.isArray(list)) return NONE

  const wasActive = (doc as { active?: unknown }).active
  const activeRoot =
    typeof wasActive === 'number' && list[wasActive] && typeof list[wasActive] === 'object'
      ? (list[wasActive] as { root?: unknown }).root
      : undefined

  const tabs: SavedTab[] = []
  const ids = new Set<string>()
  // The active tab is tracked by POSITION through the filtering, not re-found
  // by root afterwards: two tabs on one folder are legal (the strip's + allows
  // them), and a root lookup would always crown the first twin.
  let active = -1
  list.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return
    const { root, file, term, agent, cwd, id, browse, open, terms, panes } = entry as {
      id?: unknown
      browse?: unknown
      open?: unknown
      terms?: unknown
      panes?: unknown
      root?: unknown
      file?: unknown
      term?: unknown
      agent?: unknown
      cwd?: unknown
    }
    if (typeof root !== 'string' || !isAbsolute(root) || !isFolder(root)) return
    const tab: SavedTab = typeof file === 'string' && existsSync(file) ? { root, file } : { root }
    if (typeof id === 'string' && id.length > 0 && id.length <= 200 && !ids.has(id)) {
      tab.id = id
      ids.add(id)
    }
    const keptBrowse = parseBrowse(browse)
    if (keptBrowse) tab.browse = keptBrowse
    if (Array.isArray(panes)) {
      const kept: SavedPane[] = []
      for (const pane of panes.slice(0, 3)) {
        if (
          !pane ||
          typeof pane !== 'object' ||
          typeof pane.id !== 'string' ||
          typeof pane.path !== 'string' ||
          !['left', 'right', 'top', 'bottom'].includes(pane.dir)
        )
          continue
        if (
          (term === 'full' || term === 'split' || term === 'hidden') &&
          typeof pane.termSlot === 'number' &&
          Number.isInteger(pane.termSlot) &&
          pane.termSlot >= 0 &&
          pane.termSlot < Math.min(typeof terms === 'number' ? terms : 1, 16)
        ) {
          kept.push({
            id: pane.id,
            path: `term:slot-${pane.termSlot}`,
            dir: pane.dir,
            termSlot: pane.termSlot
          })
          continue
        }
        if (!isAbsolute(pane.path)) continue
        try {
          if (statSync(pane.path).isFile())
            kept.push({ id: pane.id, path: pane.path, dir: pane.dir })
        } catch {
          /* A missing pinned file is no longer a pane. */
        }
      }
      if (kept.length) tab.panes = kept
    }
    if (Array.isArray(open)) {
      const folders = open
        .slice(0, 400)
        .filter(
          (p): p is string =>
            typeof p === 'string' &&
            isAbsolute(p) &&
            (inside(root, p) || !!keptBrowse?.history.some((entry) => inside(entry.path, p))) &&
            isFolder(p)
        )
      if (folders.length) tab.open = folders
    }
    if (term === 'full' || term === 'split' || term === 'hidden') {
      tab.term = term
      if (typeof terms === 'number' && Number.isInteger(terms) && terms > 1)
        tab.terms = Math.min(terms, 16)
      // Only meaningful with a terminal. `true` is the old spelling of claude.
      if (agent === true || agent === 'claude') tab.agent = 'claude'
      else if (agent === 'codex') tab.agent = 'codex'
      // A gone folder falls back to the project. An existing outside folder
      // stays the shell's own cwd and receives a desktop-only restore grant.
      if (typeof cwd === 'string' && isAbsolute(cwd) && isFolder(cwd)) tab.cwd = cwd
    }
    if (i === wasActive) active = tabs.length
    tabs.push(tab)
  })
  // The tab that was in front is gone (or the index named nowhere): follow its
  // root to a surviving twin, else fall back to the first tab.
  if (active < 0)
    active = Math.max(
      0,
      tabs.findIndex((t) => t.root === activeRoot)
    )
  return { tabs, active }
}

export function readTabs(path: string): SavedTabs {
  try {
    return parseTabs(readFileSync(path, 'utf8'))
  } catch {
    return NONE // no file yet, or one we cannot read
  }
}

export function writeTabs(path: string, state: SavedTabs): void {
  try {
    writeFileSync(path, JSON.stringify(state))
  } catch {
    /* a viewer that cannot write its tab strip is still a viewer */
  }
}
