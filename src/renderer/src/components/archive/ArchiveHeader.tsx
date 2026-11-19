import type { JSX } from 'react'
import type { BrowseSort } from '@shared/browse'
import { nextSort } from '../../lib/downloadsView'
import { BrowseIcon } from '../icons/BrowseIcon'
import './archiveHeader.css'
import { COL_PACKED, COL_SIZE, COL_TYPE, COL_WHEN } from './entry'

// The zip panel's column header (#519): the Explorer's header made sortable.
// A click sorts by the column, a second click turns it round, and every
// column carries the same fading arrow (`.arc-sort-arrow`).

const CELLS: Array<{ key: BrowseSort['key']; label: string; cls: string }> = [
  { key: 'name', label: 'Name', cls: 'min-w-0 flex-1' },
  { key: 'type', label: 'Type', cls: COL_TYPE },
  { key: 'size', label: 'Size', cls: COL_SIZE },
  { key: 'packed', label: 'Packed', cls: COL_PACKED },
  { key: 'modified', label: 'Modified', cls: COL_WHEN }
]

export function ArchiveHeader({
  sort,
  onSort
}: {
  sort: BrowseSort
  onSort: (next: BrowseSort) => void
}): JSX.Element {
  return (
    <div
      data-arc-columns
      className="arc-columns flex h-7 shrink-0 items-center gap-2 border-b border-[color:var(--p-divider)] px-4 text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--p-dim2)]"
    >
      {CELLS.map(({ key, label, cls }) => {
        const on = sort.key === key
        const next = nextSort(sort, key, false)
        return (
          <button
            key={key}
            data-sort-key={key}
            title={`Sort by ${label.toLowerCase()}`}
            aria-label={`Sort by ${label.toLowerCase()}${on ? `, ${sort.direction === 'asc' ? 'ascending' : 'descending'}` : ''}`}
            onClick={() => onSort(next)}
            className={`${cls} flex items-center gap-1 text-left uppercase hover:text-[var(--p-text)] ${
              key === 'size' || key === 'packed' || key === 'modified' ? 'justify-end' : ''
            }`}
          >
            <span className="truncate">{label}</span>
            <span
              className="arc-sort-arrow"
              aria-hidden="true"
              data-sorted={on || undefined}
              data-descending={on ? sort.direction === 'desc' : next.direction === 'desc'}
            >
              <BrowseIcon name="up" />
            </span>
          </button>
        )
      })}
    </div>
  )
}