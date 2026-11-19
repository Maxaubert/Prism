import type { BrowseSort } from '@shared/browse'
import { naturalCompare } from '@shared/path'
import type { Entry } from '../components/archive/entry'
import { typeLabel } from './typeLabel'

// The zip panel's row order (#519): the Explorer's column keys, so the panel
// sorts like a zip in the Explorer. Folders stay first in either direction
// (File Explorer's way, outside Downloads); the direction turns the order
// inside each group. Ties fall back to the natural name order.

/** The columns the panel's header offers; the Explorer's keys. */
export const ARCHIVE_SORT_KEYS = ['name', 'type', 'size', 'packed', 'modified'] as const
export type ArchiveSortKey = (typeof ARCHIVE_SORT_KEYS)[number]

/** Name ascending, folders first: what the panel showed before it could sort. */
export const ARCHIVE_DEFAULT_SORT: BrowseSort = { key: 'name', direction: 'asc' }

function keyOf(e: Entry, key: BrowseSort['key']): string | number {
  switch (key) {
    case 'type':
      return typeLabel(e.name, e.dir)
    case 'size':
      return e.size
    case 'packed':
      return e.packed ?? e.size
    case 'modified':
      return e.mtime ?? 0
    default:
      return e.name
  }
}

export function sortMembers(rows: readonly Entry[], sort: BrowseSort): Entry[] {
  const sign = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1
    const x = keyOf(a, sort.key)
    const y = keyOf(b, sort.key)
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : naturalCompare(String(x), String(y))
    return c !== 0 ? sign * c : naturalCompare(a.name, b.name)
  })
}