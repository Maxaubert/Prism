import type { BrowseLocation, SavedBrowse } from '@shared/browse'

const MAX_HISTORY = 100

/** Windows folder identity, including equivalent slash and trailing-slash forms. */
function folderKey(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export function newBrowse(path: string, surface: SavedBrowse['surface'] = 'folder'): SavedBrowse {
  return {
    path,
    history: [
      { path, selected: null, scrollTop: 0, query: '', sort: { key: 'name', direction: 'asc' } }
    ],
    cursor: 0,
    surface,
    preview: true
  }
}

export function browseLocation(browse: SavedBrowse): BrowseLocation {
  return browse.history[browse.cursor]
}

/** Save only the visible folder's view state; history and session identity stay put. */
export function updateBrowseLocation(
  browse: SavedBrowse,
  patch: Partial<Omit<BrowseLocation, 'path'>>
): SavedBrowse {
  const history = browse.history.slice()
  history[browse.cursor] = { ...browseLocation(browse), ...patch }
  return { ...browse, history }
}

/**
 * What is MARKED in a folder you arrive at (owner, 2026-09-22: "no file should
 * be selected when I haven't clicked any. The highlighted thing should either
 * be because I clicked it or it's the current file displaying, or I've
 * navigated onto it with the arrow keys"). Arriving - a place in the sidebar,
 * a crumb, the parent, Back or Forward - clicks nothing, so the mark is the
 * file on display when it lives in this folder, and nothing otherwise. What an
 * earlier visit selected is NOT brought back: it made the subfolder you had
 * come out of look picked. The order and the scroll are still remembered.
 *
 * ONE EXCEPTION, the way out (owner, 2026-09-23: "when you move back to
 * documents, the claude folder should be highlighted, when you go to admin,
 * documents should be highlighted"): arriving at the DIRECT parent of the
 * folder you were in marks that folder, so going back up shows where you came
 * from and the arrows carry on from it. A jump anywhere else still marks
 * nothing. The file on display, when it lives here, wins.
 */
function arrivalMark(path: string, shown: string | null | undefined, from?: string): string | null {
  const here = (p: string | null | undefined): boolean => {
    const parent = p ? browseParent(p) : null
    return !!parent && folderKey(parent) === folderKey(path)
  }
  if (here(shown)) return shown!
  return from && here(from) ? from : null
}

/** Called after main has successfully resolved the folder. A failed lookup has
 *  no history entry. `shown` is the file on display, if any. */
export function navigateBrowseState(
  browse: SavedBrowse,
  path: string,
  shown?: string | null
): SavedBrowse {
  if (folderKey(browse.path) === folderKey(path)) return { ...browse, surface: 'folder' }
  // Revisiting a place restores its order and scroll even by a breadcrumb or
  // shortcut; never its selection (arrivalMark).
  const previous = browse.history.findLast((entry) => folderKey(entry.path) === folderKey(path))
  const entry = previous
    ? { ...previous, path, selected: arrivalMark(path, shown, browse.path) }
    : {
        ...newBrowse(path).history[0],
        selected: arrivalMark(path, shown, browse.path),
        sort: { ...browseLocation(browse).sort }
      }
  const history = [...browse.history.slice(0, browse.cursor + 1), entry].slice(-MAX_HISTORY)
  return { ...browse, path, history, cursor: history.length - 1, surface: 'folder' }
}

export function travelBrowseState(browse: SavedBrowse, delta: number, shown?: string | null): SavedBrowse {
  const cursor = Math.max(0, Math.min(browse.history.length - 1, browse.cursor + Math.trunc(delta)))
  if (cursor === browse.cursor) return browse
  const target = browse.history[cursor]
  const history = browse.history.slice()
  history[cursor] = { ...target, selected: arrivalMark(target.path, shown, browse.path) }
  return { ...browse, history, cursor, path: target.path, surface: 'folder' }
}

/** The drive or UNC share is the top, never an invalid C: or bare server name. */
export function browseParent(path: string): string | null {
  const normalized = path.replace(/\//g, '\\').replace(/\\+$/, '')
  if (/^[a-z]:$/i.test(normalized) || /^\\\\[^\\]+\\[^\\]+$/.test(normalized)) return null
  const cut = normalized.lastIndexOf('\\')
  if (cut < 0) return null
  const parent = normalized.slice(0, cut)
  if (!parent || /^\\\\[^\\]+$/.test(parent)) return null
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent
}

export interface BrowseCrumb {
  name: string
  path: string
}

export function browseCrumbs(path: string): BrowseCrumb[] {
  const crumbs: BrowseCrumb[] = []
  let at: string | null = path
  while (at) {
    const parent = browseParent(at)
    const name = parent
      ? at
          .replace(/[\\/]+$/, '')
          .split(/[\\/]/)
          .pop()!
      : at
    crumbs.unshift({ name, path: at })
    at = parent
  }
  return crumbs
}
