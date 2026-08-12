import { useSyncExternalStore } from 'react'
import type { ViewerFile } from '@shared/types'

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

const byName = (a: ViewerFile, b: ViewerFile): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true })

/** A new array of the same file objects, ordered by field + direction. Ties
 *  (and the tie inside every non-name field) fall back to natural name order. */
export function sortFiles(files: ViewerFile[], field: SortField, dir: SortDir): ViewerFile[] {
  const primary = (a: ViewerFile, b: ViewerFile): number => {
    switch (field) {
      case 'modified': return a.mtimeMs - b.mtimeMs
      case 'size': return a.size - b.size
      case 'type': return a.kind.localeCompare(b.kind)
      default: return byName(a, b)
    }
  }
  const flip = dir === 'desc' ? -1 : 1
  return [...files].sort((a, b) => flip * (primary(a, b) || byName(a, b)))
}

/* ---------- the persisted setting ---------- */

const KEY = 'prism.sort'

function load(): { field: SortField; dir: SortDir } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<{ field: SortField; dir: SortDir }>
    return {
      field: SORT_FIELDS.some((f) => f.id === raw.field) ? (raw.field as SortField) : DEFAULT_SORT.field,
      dir: raw.dir === 'desc' ? 'desc' : 'asc'
    }
  } catch {
    return DEFAULT_SORT
  }
}

let sort = load()
const listeners = new Set<() => void>()

function save(next: { field: SortField; dir: SortDir }): void {
  sort = next
  try {
    localStorage.setItem(KEY, JSON.stringify(sort))
  } catch {
    /* no storage: it lasts the session */
  }
  listeners.forEach((l) => l())
}

export const setSortField = (field: SortField): void => save({ ...sort, field })
export const setSortDir = (dir: SortDir): void => save({ ...sort, dir })

export function useSort(): { field: SortField; dir: SortDir } {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => sort
  )
}
