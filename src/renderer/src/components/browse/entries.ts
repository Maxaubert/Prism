import type { DirListing } from '@shared/types'
import { matchesQuery, parseQuery } from '@shared/searchQuery'
import { naturalCompare } from '@shared/path'
import { newer, sortFiles } from '../../lib/prefs/sortPrefs'
import { browseParent } from '../../lib/browse'
import type { BrowseEntry, BrowseSort } from './types'
import type { FolderSizes } from '../../lib/folderSize'

/** Every file and folder has its date (#271 sends them after the names). */
export function datesKnown(listing: DirListing | null): boolean {
  return (
    !!listing &&
    listing.folders.every((f) => f.mtimeMs !== undefined) &&
    listing.files.every((f) => f.mtimeMs !== undefined)
  )
}

/** The dates can order the rows: every one has arrived, or the listing was
 *  carried from the one on screen (perf review #3, 2026-10-28), so the only
 *  rows without one are new and sort as the newest until their patch lands.
 *  A refresh that brings a download no longer drops Downloads to A-Z. */
export function datesUsable(listing: DirListing | null): boolean {
  return !!listing && (!!listing.carried || datesKnown(listing))
}

/**
 * THE ORDER KEPT, THE ROWS REFILLED (perf review #11 and #20, 2026-10-28).
 * A details patch (every 50 ms while a folder's sizes and dates stream in)
 * and a folder-size tick (every 16 ms while folders are measured) re-sorted
 * the whole folder, though for most sorts neither can move a row: by Name,
 * Type or Path the details do not count, and only a Size sort reads the
 * folder sizes. `sameOrder` says when the previous pass's order still holds;
 * `refill` then lays the new objects over it in one linear pass.
 */
export function sameOrder(
  prev: { listing: DirListing | null; query: string; sort: BrowseSort; sizes: FolderSizes; dated: boolean },
  next: { listing: DirListing | null; query: string; sort: BrowseSort; sizes: FolderSizes; dated: boolean }
): boolean {
  if (
    !prev.listing ||
    !next.listing ||
    prev.query !== next.query ||
    prev.sort.key !== next.sort.key ||
    prev.sort.direction !== next.sort.direction ||
    prev.dated !== next.dated
  )
    return false
  const key = next.sort.key
  const bySize = key === 'size' || key === 'packed'
  if (prev.sizes !== next.sizes && bySize) return false
  if (prev.listing === next.listing) return true
  // A new listing keeps the order only if the details cannot move a row and
  // the rows are the same paths in the same places.
  if (bySize || key === 'modified') return false
  if (
    !!prev.listing.archive !== !!next.listing.archive ||
    prev.listing.folders.length !== next.listing.folders.length ||
    prev.listing.files.length !== next.listing.files.length
  )
    return false
  for (let i = 0; i < next.listing.folders.length; i++)
    if (prev.listing.folders[i].path !== next.listing.folders[i].path) return false
  for (let i = 0; i < next.listing.files.length; i++)
    if (prev.listing.files[i].path !== next.listing.files[i].path) return false
  return true
}

/** The previous rows, in their order, with this listing's objects and these
 *  folder sizes. A row nothing changed keeps its object. */
export function refill(
  prev: readonly BrowseEntry[],
  prevListing: DirListing,
  listing: DirListing,
  sizes: FolderSizes
): BrowseEntry[] {
  const sameListing = prevListing === listing
  const folders = sameListing ? null : new Map(listing.folders.map((f) => [f.path, f]))
  const files = sameListing ? null : new Map(listing.files.map((f) => [f.path, f]))
  return prev.map((entry) => {
    if (entry.isFolder) {
      const folder = folders?.get(entry.path)
      const size = sizes[entry.path]
      if (!folder) return entry.folderSize === size ? entry : { ...entry, folderSize: size }
      return { ...folder, isFolder: true, folderSize: size }
    }
    const file = files?.get(entry.path)
    return file && file !== entry.file ? { path: file.path, name: file.name, isFolder: false, file } : entry
  })
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
  // Packed exists only inside an archive (#300): anywhere else it is Size,
  // so a sort carried out of a zip still means something.
  if (sort.key === 'packed' && !listing.archive) sort = { ...sort, key: 'size' }
  const terms = parseQuery(query)
  const matches = (entry: { name: string }): boolean =>
    !query.trim() || matchesQuery(entry.name, terms)
  if (mixed && sort.key === 'modified' && datesUsable(listing)) {
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
      (a, b) => flip * newer(a.mtimeMs, b.mtimeMs) || naturalCompare(a.name, b.name)
    )
  }
  const direction = sort.key === 'name' && sort.direction === 'desc' ? -1 : 1
  // Folders show their dates now (#285), so by Date modified they are ordered
  // by them too, inside the folders-first block, once every folder's date is
  // in (as `sortFiles` waits for the files'): a column that says one order
  // while the rows keep another reads as broken.
  const foldersByDate =
    sort.key === 'modified' &&
    (!!listing.carried || listing.folders.every((f) => f.mtimeMs !== undefined))
  const folders = listing.folders.filter(matches).sort((a, b) => {
    if (foldersByDate) {
      const by = newer(a.mtimeMs, b.mtimeMs)
      if (by) return (sort.direction === 'desc' ? -1 : 1) * by
      return naturalCompare(a.name, b.name)
    }
    if (sort.key === 'path')
      return (
        (sort.direction === 'asc' ? 1 : -1) *
        (naturalCompare(browseParent(a.path) ?? a.path, browseParent(b.path) ?? b.path) ||
          naturalCompare(a.name, b.name))
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
    return direction * naturalCompare(a.name, b.name)
  })
  const files =
    sort.key === 'path'
      ? listing.files
          .filter(matches)
          .sort(
            (a, b) =>
              (sort.direction === 'asc' ? 1 : -1) *
              (naturalCompare(browseParent(a.path) ?? a.path, browseParent(b.path) ?? b.path) ||
                naturalCompare(a.name, b.name))
          )
      : sortFiles(listing.files.filter(matches), sort.key, sort.direction, !!listing.carried)
  return [
    ...folders.map((folder) => ({ ...folder, isFolder: true, folderSize: sizes[folder.path] })),
    ...files.map((file) => ({ path: file.path, name: file.name, isFolder: false, file }))
  ]
}
