import type { DirListing } from '@shared/types'
import { matchesQuery, parseQuery } from '@shared/searchQuery'
import { sortFiles } from '../../lib/sortPrefs'
import type { BrowseEntry, BrowseSort } from './types'

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function browseEntries(
  listing: DirListing | null,
  query: string,
  sort: BrowseSort
): BrowseEntry[] {
  if (!listing) return []
  const terms = parseQuery(query)
  const matches = (entry: { name: string }): boolean =>
    !query.trim() || matchesQuery(entry.name, terms)
  const direction = sort.key === 'name' && sort.direction === 'desc' ? -1 : 1
  const folders = listing.folders
    .filter(matches)
    .sort((a, b) => direction * names.compare(a.name, b.name))
  const files = sortFiles(listing.files.filter(matches), sort.key, sort.direction)
  return [
    ...folders.map((folder) => ({ ...folder, isFolder: true })),
    ...files.map((file) => ({ path: file.path, name: file.name, isFolder: false, file }))
  ]
}
