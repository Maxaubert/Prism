import type { DirListing } from '@shared/types'
import { matchesQuery, parseQuery } from '@shared/searchQuery'
import { sortFiles } from '../../lib/sortPrefs'
import { browseParent } from '../../lib/browse'
import type { BrowseEntry, BrowseSort } from './types'
import type { FolderSizes } from '../../lib/folderSize'

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Every file and folder has its date (#271 sends them after the names). */
export function datesKnown(listing: DirListing | null): boolean {
  return (
    !!listing &&
    listing.folders.every((f) => f.mtimeMs !== undefined) &&
    listing.files.every((f) => f.mtimeMs !== undefined)
  )
}

/**
 * The rows in order. `mixed` is Downloads' date view (#285): files and
 * folders together by date modified, the name breaking a tie, with no
 * folders-first rule. Until every date has arrived the rows stay in the
 * ordinary order, as `sortFiles` keeps a names-first listing by name (#271),
 * so they move once, when the dates are in, rather than on every patch.
 */
export function browseEntries(
  listing: DirListing | null,
  query: string,
  sort: BrowseSort,
  sizes: FolderSizes = {},
  mixed = false
): BrowseEntry[] {
  if (!listing) return []
  const terms = parseQuery(query)
  const matches = (entry: { name: string }): boolean =>
    !query.trim() || matchesQuery(entry.name, terms)
  if (mixed && sort.key === 'modified' && datesKnown(listing)) {
    const flip = sort.direction === 'desc' ? -1 : 1
    const rows: BrowseEntry[] = [
      ...listing.folders
        .filter(matches)
        .map((folder) => ({ ...folder, isFolder: true, folderSize: sizes[folder.path] })),
      ...listing.files
        .filter(matches)
        .map((file) => ({ path: file.path, name: file.name, isFolder: false, file, mtimeMs: file.mtimeMs }))
    ]
    return rows.sort(
      (a, b) => flip * ((a.mtimeMs ?? 0) - (b.mtimeMs ?? 0)) || names.compare(a.name, b.name)
    )
  }
  const direction = sort.key === 'name' && sort.direction === 'desc' ? -1 : 1
  // Folders show their dates now (#285), so by Date modified they are ordered
  // by them too, inside the folders-first block, once every folder's date is
  // in (as `sortFiles` waits for the files'): a column that says one order
  // while the rows keep another reads as broken.
  const foldersByDate =
    sort.key === 'modified' && listing.folders.every((f) => f.mtimeMs !== undefined)
  const folders = listing.folders.filter(matches).sort((a, b) => {
    if (foldersByDate) {
      const by = (a.mtimeMs ?? 0) - (b.mtimeMs ?? 0)
      if (by) return (sort.direction === 'desc' ? -1 : 1) * by
      return names.compare(a.name, b.name)
    }
    if (sort.key === 'path')
      return (
        (sort.direction === 'asc' ? 1 : -1) *
        (names.compare(browseParent(a.path) ?? a.path, browseParent(b.path) ?? b.path) ||
          names.compare(a.name, b.name))
      )
    if (sort.key === 'size') {
      const left = sizes[a.path]?.bytes
      const right = sizes[b.path]?.bytes
      // Unknown totals stay last in either direction, never masquerading as zero.
      if (left === undefined && right !== undefined) return 1
      if (right === undefined && left !== undefined) return -1
      if (left !== undefined && right !== undefined && left !== right)
        return (sort.direction === 'asc' ? 1 : -1) * (left - right)
    }
    return direction * names.compare(a.name, b.name)
  })
  const files =
    sort.key === 'path'
      ? listing.files
          .filter(matches)
          .sort(
            (a, b) =>
              (sort.direction === 'asc' ? 1 : -1) *
              (names.compare(browseParent(a.path) ?? a.path, browseParent(b.path) ?? b.path) ||
                names.compare(a.name, b.name))
          )
      : sortFiles(listing.files.filter(matches), sort.key, sort.direction)
  return [
    ...folders.map((folder) => ({ ...folder, isFolder: true, folderSize: sizes[folder.path] })),
    ...files.map((file) => ({ path: file.path, name: file.name, isFolder: false, file }))
  ]
}
