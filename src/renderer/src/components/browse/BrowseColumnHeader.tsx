import type { JSX, RefObject } from 'react'
import type { BrowseSort } from '@shared/browse'
import { nextSort } from '../../lib/downloadsView'
import { BrowseIcon } from '../icons/BrowseIcon'
import type { BrowseColumn } from './browseColumns'

/**
 * The list's header: one sort button per column (or a grid's packed strip). It
 * scrolls sideways with the list under it, and the two follow each other.
 */
export function BrowseColumnHeader({
  columns,
  sort,
  downloads,
  onSortChange,
  headerRef,
  listRef
}: {
  columns: readonly BrowseColumn[]
  sort: BrowseSort
  downloads: boolean
  onSortChange: (sort: BrowseSort) => void
  /** The header's own scroll box. */
  headerRef: RefObject<HTMLDivElement | null>
  /** The list under it, whose sideways scroll the header follows. */
  listRef: RefObject<HTMLDivElement | null>
}): JSX.Element {
  return (
    <div
      className="browse-column-viewport"
      ref={headerRef}
      onScroll={(event) => {
        const head = event.currentTarget
        const list = listRef.current
        if (list && list.scrollLeft !== head.scrollLeft) {
          list.scrollLeft = head.scrollLeft
          // A list with nothing to scroll cannot follow: the header goes
          // back to it, or a focused last header cell (its box runs on to
          // the edge) leaves the labels shifted off their columns. Seen
          // in the bin, where Type is the last cell.
          if (list.scrollLeft !== head.scrollLeft) head.scrollLeft = list.scrollLeft
        }
      }}
    >
      <div className="browse-columns">
        {columns.map(({ key, label }) => (
          <button
            key={key}
            className={`browse-column-${key}`}
            title={`Sort by ${label.toLowerCase()}`}
            aria-label={`Sort by ${label.toLowerCase()}${sort.key === key ? `, ${sort.direction === 'asc' ? 'ascending' : 'descending'}` : ''}`}
            onClick={() => onSortChange(nextSort(sort, key, downloads))}
          >
            {label}
            {/* Every column carries its arrow, as File Explorer's do (owner,
                2026-10-04: "that arrow shows only when you hover over them
                while the currently sorted item has an arrow at all times").
                It is always in the layout and only fades in, so a hover
                never moves the label. Unsorted, it points the way a click
                would sort (ascending; Date modified in Downloads, newest
                first, #285). */}
            <span
              className="browse-sort-arrow"
              aria-hidden="true"
              data-sorted={sort.key === key || undefined}
              data-descending={
                sort.key === key
                  ? sort.direction === 'desc'
                  : nextSort(sort, key, downloads).direction === 'desc'
              }
            >
              <BrowseIcon name="up" />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
