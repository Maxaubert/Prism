import { createPref } from './createPref'
import type { ViewerFile } from '@shared/types'
import { byName } from '@shared/path'

// How the folder is ordered: one field, one direction, shared by the tree rows
// and the arrow-key paging so what you see is what the arrows walk. Persisted,
// like the navigation scope beside it.

export type SortField = 'name' | 'modified' | 'size' | 'type'
export type SortDir = 'asc' | 'desc'

export const SORT_FIELDS: Array<{ id: SortField; name: string }> = [
  { id: 'name', name: 'Name' },
  { id: 'modified', name: 'Date modified' },
  { id: 'size', name: 'Size' },
  { id: 'type', name: 'Type' }
]

export const DEFAULT_SORT = { field: 'name' as SortField, dir: 'asc' as SortDir }

// `byName` is the one hoisted collator (#271, now `@shared/path`): a
// `localeCompare` with options builds a fresh one on EVERY comparison.
// MEASURED on a new folder of 2000 files (the newFolder2000 e2e): 42 to 58 ms
// from the double-click to the first row before, 25 ms after.

/** A new array of the same file objects, ordered by field + direction. Ties
 *  (and the tie inside every non-name field) fall back to natural name order.
 *
 *  SIZE AND DATE WAIT FOR THEIR DETAILS (#271): while any file of a
 *  names-first listing has no size (or date) yet, that sort is the NAME
 *  order, and it re-sorts once when the last patch lands. Sorting half the
 *  rows by a number and half by nothing would shuffle the list on every patch.
 *
 *  EXCEPT A CARRIED LISTING (`carried`, perf review #3, 2026-10-28): a refresh
 *  of a folder on screen keeps the details it had, so only NEW files lack
 *  them. The order stays; a file with no date yet is the newest, one with no
 *  size yet goes last in either direction, until its patch lands. */
export function sortFiles(
  files: ViewerFile[],
  field: SortField | 'packed',
  dir: SortDir,
  carried = false
): ViewerFile[] {
  if (
    !carried &&
    ((field === 'size' && files.some((f) => f.size === undefined)) ||
      (field === 'modified' && files.some((f) => f.mtimeMs === undefined)))
  ) {
    field = 'name'
    dir = 'asc'
  }
  const flip = dir === 'desc' ? -1 : 1
  if (field === 'size') {
    // Unknown sizes last in either direction (a carried listing's new rows).
    return [...files].sort((a, b) => {
      if (a.size === undefined || b.size === undefined)
        return a.size === b.size ? byName(a, b) : a.size === undefined ? 1 : -1
      return flip * (a.size - b.size || byName(a, b))
    })
  }
  const primary = (a: ViewerFile, b: ViewerFile): number => {
    switch (field) {
      case 'modified': return newer(a.mtimeMs, b.mtimeMs)
      // Inside an archive (#300): what each member occupies in the container.
      case 'packed': return (a.packed ?? 0) - (b.packed ?? 0)
      case 'type': return a.kind.localeCompare(b.kind)
      default: return byName(a, b)
    }
  }
  return [...files].sort((a, b) => flip * (primary(a, b) || byName(a, b)))
}

/** Two dates in ascending order, a missing one the newest (a carried
 *  listing's new row, perf review #3). */
export function newer(a: number | undefined, b: number | undefined): number {
  const x = a ?? Infinity
  const y = b ?? Infinity
  return x === y ? 0 : x < y ? -1 : 1
}

/* ---------- the persisted setting ---------- */

const pref = createPref<{ field: SortField; dir: SortDir }>({
  key: 'prism.sort',
  parse: (stored) => {
    const raw = JSON.parse(stored ?? '{}') as Partial<{ field: SortField; dir: SortDir }>
    return {
      field: SORT_FIELDS.some((f) => f.id === raw.field) ? (raw.field as SortField) : DEFAULT_SORT.field,
      dir: raw.dir === 'desc' ? 'desc' : 'asc'
    }
  },
  serialize: (sort) => JSON.stringify(sort),
  fallback: DEFAULT_SORT
})

export const setSortField = (field: SortField): void => pref.set({ ...pref.get(), field })
export const setSortDir = (dir: SortDir): void => pref.set({ ...pref.get(), dir })

export const useSort = pref.use
