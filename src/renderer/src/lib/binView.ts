import type { BrowseSort } from '@shared/browse'
import type { BinnedFrom } from '@shared/types'

/**
 * THE RECYCLE BIN'S LIST (Recycle Bin feature, D6 and D7; owner, 2026-11-10:
 * "newest deleted first"). A sort nobody picked there is Date deleted, newest
 * first, which is what someone who just deleted something wants (File Explorer
 * opens its bin by Name). Picked by a column header it is remembered like any
 * place's, and it never travels to the next folder (`viewSort`).
 */
export const BIN_SORT: BrowseSort = { key: 'deleted', direction: 'desc' }

/** The columns, in this order (D7). Size and Type are the list's own. */
export const binColumns: Array<{ key: BrowseSort['key']; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'from', label: 'Original location' },
  { key: 'deleted', label: 'Date deleted' },
  { key: 'size', label: 'Size' },
  { key: 'type', label: 'Type' }
]

/** Where a bin row came from, for a file or a folder row. */
export function binnedOf(entry: {
  file?: { binned?: BinnedFrom }
  binned?: BinnedFrom
}): BinnedFrom | undefined {
  return entry.file ? entry.file.binned : entry.binned
}

/** The full original path of a binned item: its folder and its name. */
export function binnedPath(from: string, name: string): string {
  if (!from) return name
  return from.endsWith('\\') || from.endsWith('/') ? `${from}${name}` : `${from}\\${name}`
}

/** What the strip's first two buttons say for `marked` rows (the menu's wording). */
export function binStripLabels(marked: number): { restore: string; remove: string } {
  return marked > 1
    ? { restore: `Restore ${marked} items`, remove: `Delete ${marked} items permanently` }
    : { restore: 'Restore', remove: 'Delete permanently' }
}

/** The list's empty state (D6). */
export const BIN_EMPTY = 'The Recycle Bin is empty.'
