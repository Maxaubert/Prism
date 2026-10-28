import { containerSync } from './archiveBrowse'
import { isLocalFixed } from './driveKinds'
import { existsSync, readFileSync, statSync } from 'fs'
import { latestWriter } from './latestWrite'
import { isAbsolute } from 'path'
import type { BrowseLocation, SavedBrowse } from '@shared/browse'

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
  /** Every saved tab is an Explorer tab now. An older strip's project tabs
   *  (`role: 'project'`, or no role) are migrated by `parseTabs`. */
  role?: 'explorer'
  pinned?: boolean
  browse?: SavedBrowse
  root: string
  /** The file that tab was showing. Absent if it was showing none. */
  file?: string
}

export interface SavedTabs {
  tabs: SavedTab[]
  /** Index into `tabs` of the one that was in front. */
  active: number
}

const NONE: SavedTabs = { tabs: [], active: 0 }

const isFolder = (p: string): boolean => {
  try {
    // sync-ok: startup, the tab restore (once per page load, before the strip shows)
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * A place a tab may come back to: a folder, or a place INSIDE an archive
 * (#300) whose container is still a file there. Only the container is
 * stat'ed, never read: the restore stays fast (#271), and a folder that has
 * gone from inside the zip is found when it is listed, which falls back.
 */
// sync-ok: startup, the tab restore (once per page load, before the strip shows)
const isPlace = (p: string): boolean => isFolder(p) || containerSync(p) !== null

/**
 * The BULK of a strip - up to 100 history entries and 400 open tree folders a
 * tab - is checked only on this PC's own fixed disks (2026-10-16). Each check
 * is a synchronous stat at startup, and on an offline share or mapped drive
 * each one waited out the SMB timeout with main frozen: a tab whose history
 * had wandered a share held the window for minutes. Anywhere else the entry
 * is kept unchecked; a place that has gone is found when it is navigated to
 * or expanded, as one deleted mid-session is.
 */
const mayBePlace = (p: string): boolean => !isLocalFixed(p) || isPlace(p)

/**
 * THE SAME RULE FOR A TAB'S OWN ROOT, PATH AND FILE (review, 2026-10-28: "look
 * for stall points"). Only the history had it: a tab whose root or current
 * folder sat on an offline share still waited out the SMB timeout here, and
 * this runs on every page load (a reload or a crash recovery too), not only
 * at startup. Off this PC's own fixed disks they are kept unchecked; the
 * async listing finds a folder that has gone, and the viewer a file.
 */
const mayBeFolder = (p: string): boolean => !isLocalFixed(p) || isFolder(p)
// sync-ok: startup, the tab restore (once per page load, before the strip shows)
const mayExist = (p: string): boolean => !isLocalFixed(p) || existsSync(p)

/** History is a bounded suggestion. Each surviving location keeps its own view. */
export function parseBrowse(raw: unknown): SavedBrowse | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Partial<SavedBrowse>
  if (typeof value.path !== 'string' || !isAbsolute(value.path) || !mayBePlace(value.path))
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
      !mayBePlace(location.path)
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
        key: ['name', 'path', 'type', 'size', 'modified', 'packed'].includes(location.sort?.key)
          ? location.sort.key
          : 'name',
        direction: location.sort?.direction === 'desc' ? 'desc' : 'asc'
      },
      ...(location.sortChosen === true ? { sortChosen: true as const } : {})
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
  let keptPinnedExplorer = false
  // The active tab is tracked by POSITION through the filtering, not re-found
  // by root afterwards: two tabs on one folder are legal (the strip's + allows
  // them), and a root lookup would always crown the first twin.
  let active = -1
  list.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return
    // THE TERMINAL AND THE PROJECT TABS ARE GONE (owner, 2026-10-26). An old
    // strip's `term`, `terms`, `agent`, `agentResume`, `cwd`, `panes` and `open`
    // (the tree's folders) are never read, so a tab that had a shell or a
    // pinned pane comes back as the plain tab it was. A tab that was a project
    // (`role: 'project'`, or no role at all) comes back as an Explorer tab at
    // the folder it was showing (`browse.path`, else its root), with the file
    // it had open still open in the full viewer.
    const { root, file, id, browse, role, pinned } = entry as {
      id?: unknown
      role?: unknown
      pinned?: unknown
      browse?: unknown
      root?: unknown
      file?: unknown
    }
    if (typeof root !== 'string' || !isAbsolute(root) || !mayBeFolder(root)) return
    const tab: SavedTab =
      typeof file === 'string' && isAbsolute(file) && mayExist(file) ? { root, file } : { root }
    tab.role = 'explorer'
    if (role === 'explorer' && pinned === true && !keptPinnedExplorer) {
      tab.pinned = true
      keptPinnedExplorer = true
    }
    if (typeof id === 'string' && id.length > 0 && id.length <= 200 && !ids.has(id)) {
      tab.id = id
      ids.add(id)
    }
    const keptBrowse = parseBrowse(browse)
    // The migration. A project tab's own `browse.surface` said whether the
    // viewer or the folder list was in front; for it the open file decides. A
    // project tab with no `browse` at all needs none made: the page opens its
    // folder (or its file) at `root`.
    if (keptBrowse)
      tab.browse =
        role === 'explorer'
          ? keptBrowse
          : { ...keptBrowse, surface: tab.file ? 'viewer' : 'folder' }
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
    // sync-ok: startup, the tab restore (once per page load, before the strip shows)
    return parseTabs(readFileSync(path, 'utf8'))
  } catch {
    return NONE // no file yet, or one we cannot read
  }
}

/**
 * THE TAB STRIP IS SAVED OFF THE MAIN THREAD (owner, 2026-10-12: the app
 * "stalled for like 5 seconds"). `writeFileSync` on the debounce held main for
 * 3954 ms writing a 20 KB file while Windows had the disk busy (MEASURED, a
 * CPU profile of the owner's main process: every sample of the stall was in
 * writeFileUtf8 under writeTabs). `write` hands the bytes to libuv's thread
 * pool and swaps them in with a rename, so a slow disk delays the file, never
 * the app, and a crash mid-write leaves the old file whole. Only `flushSync`,
 * at quit, still waits: a lost last write is a strip that never comes back.
 * Writes run one at a time and the newest lands last (`latestWriter`).
 */
export function tabsWriter(path: () => string): {
  write: (state: SavedTabs) => Promise<void>
  flushSync: (state: SavedTabs) => void
} {
  const file = latestWriter(path)
  return {
    write: (state) => file.write(JSON.stringify(state)),
    // sync-ok: the quit flush (window close)
    flushSync: (state) => file.flushSync(JSON.stringify(state))
  }
}
