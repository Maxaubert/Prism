import type { BrowseLocation, BrowseShortcut, BrowseSort } from '@shared/browse'

/**
 * DOWNLOADS IS NEWEST FIRST, FILES AND FOLDERS TOGETHER, IN DATE GROUPS (#285;
 * owner, 2026-10-04: "make the downloads folder in prism in the explorer not
 * have that folders first rule, just like file explorer, instead it's
 * naturally sorted by date"). The rules, pure:
 *
 * - Downloads is the Known Folder (`known: 'downloads'`, what Quick access
 *   shows), never a folder that happens to be called Downloads.
 * - There a sort nobody picked is Downloads' own: Date modified, newest first.
 *   A pick by a column header (`sortChosen`) is remembered as any folder's is
 *   (its history entry), and Downloads' own sort never travels to the next
 *   folder, which takes the sort it would have taken anyway.
 * - Sorted by Date modified, in either direction, Downloads mixes files and
 *   folders and shows the date groups. Any other column is any folder's view:
 *   folders first, no groups. A search is never grouped.
 */

export const DOWNLOADS_SORT: BrowseSort = { key: 'modified', direction: 'desc' }

const folderKey = (path: string): string =>
  path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

export function downloadsPath(locations: readonly BrowseShortcut[]): string | null {
  return locations.find((l) => l.known === 'downloads')?.path ?? null
}

export function isDownloads(path: string | null | undefined, downloads: string | null): boolean {
  return !!path && !!downloads && folderKey(path) === folderKey(downloads)
}

/** The sort the folder is shown in. */
export function viewSort(
  location: Pick<BrowseLocation, 'sort' | 'sortChosen'>,
  downloads: boolean
): BrowseSort {
  return downloads && !location.sortChosen ? DOWNLOADS_SORT : location.sort
}

/** Files and folders mixed by date, under date dividers. */
export function dateView(downloads: boolean, sort: BrowseSort, searching: boolean): boolean {
  return downloads && !searching && sort.key === 'modified'
}

/** What a click on a column header asks for. Date modified in Downloads
 *  starts newest first, as File Explorer's does; every other first click is
 *  ascending, and a second click turns it round. */
export function nextSort(current: BrowseSort, key: BrowseSort['key'], downloads: boolean): BrowseSort {
  if (current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  return { key, direction: downloads && key === 'modified' ? 'desc' : 'asc' }
}
