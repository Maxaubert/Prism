import type { DirListing } from '@shared/types'
import { matchesQuery, parseQuery } from '@shared/searchQuery'
import { sortFiles } from '../../lib/sortPrefs'
import type { BrowseEntry, BrowseSort } from './types'
import type { FolderSizes } from '../../lib/folderSize'

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function browseEntries(
  listing: DirListing | null,
  query: string,
  sort: BrowseSort,
  sizes: FolderSizes = {}
): BrowseEntry[] {
  if (!listing) return []
  const terms = parseQuery(query)
  const matches = (entry: { name: string }): boolean =>
    !query.trim() || matchesQuery(entry.name, terms)
  const direction = sort.key === 'name' && sort.direction === 'desc' ? -1 : 1
  const folders = listing.folders.filter(matches).sort((a, b) => {
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
  const files = sortFiles(listing.files.filter(matches), sort.key, sort.direction)
  return [
    ...folders.map((folder) => ({ ...folder, isFolder: true, folderSize: sizes[folder.path] })),
    ...files.map((file) => ({ path: file.path, name: file.name, isFolder: false, file }))
  ]
}
