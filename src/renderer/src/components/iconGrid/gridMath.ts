/**
 * THE ICON GRID'S ARITHMETIC (folder icons, 2026-10-31), pure so it is tested
 * without a page: fixed square cells, as many columns as fit, rows drawn only
 * for the visible band plus a few rows either side. Nothing here depends on
 * how many icons there are beyond the row count, which is why 2,000 icons cost
 * what 100 do.
 */

export const OVERSCAN_ROWS = 3

export function columnsFor(width: number, cell: number): number {
  return Math.max(1, Math.floor(width / cell))
}

export function rowCount(count: number, columns: number): number {
  return Math.ceil(Math.max(0, count) / Math.max(1, columns))
}

/** Rows [first, end) to put in the DOM for a scroll position. */
export function visibleRows(
  scrollTop: number,
  height: number,
  cell: number,
  rows: number,
  overscan = OVERSCAN_ROWS
): { first: number; end: number } {
  if (rows <= 0) return { first: 0, end: 0 }
  const top = Math.floor(Math.max(0, scrollTop) / cell)
  const bottom = Math.ceil((Math.max(0, scrollTop) + Math.max(0, height)) / cell)
  return { first: Math.max(0, top - overscan), end: Math.min(rows, bottom + overscan) }
}

export function cellOf(index: number, columns: number): { row: number; col: number } {
  return { row: Math.floor(index / columns), col: index % columns }
}

/** The scrollTop that shows `index`'s row whole, moving as little as it can
 *  (the same position when it is already in view). */
export function scrollFor(
  index: number,
  columns: number,
  cell: number,
  scrollTop: number,
  height: number
): number {
  const top = cellOf(index, columns).row * cell
  if (top < scrollTop) return top
  if (top + cell > scrollTop + height) return Math.max(0, top + cell - height)
  return scrollTop
}

/**
 * Where a key moves the active cell: arrows one cell, Home and End the row's
 * ends, Ctrl+Home and Ctrl+End the list's, PageUp and PageDown a page of rows.
 * Undefined for any other key. Never leaves the list.
 */
export function moveIndex(
  index: number,
  key: string,
  columns: number,
  count: number,
  pageRows: number,
  ctrl = false
): number | undefined {
  if (count <= 0) return undefined
  const last = count - 1
  const at = Math.min(Math.max(index, 0), last)
  const rowStart = at - (at % columns)
  const clamp = (i: number): number => Math.min(Math.max(i, 0), last)
  switch (key) {
    case 'ArrowRight':
      return clamp(at + 1)
    case 'ArrowLeft':
      return clamp(at - 1)
    case 'ArrowDown':
      return at + columns <= last ? at + columns : at
    case 'ArrowUp':
      return at - columns >= 0 ? at - columns : at
    case 'Home':
      return ctrl ? 0 : rowStart
    case 'End':
      return ctrl ? last : Math.min(rowStart + columns - 1, last)
    case 'PageDown':
      return clamp(at + columns * Math.max(1, pageRows))
    case 'PageUp':
      return clamp(at - columns * Math.max(1, pageRows))
    default:
      return undefined
  }
}

/** Is cell `index` in the rows [first, end) the DOM holds? `aria-activedescendant`
 *  names it only then: after a wheel scroll the active cell may be gone. */
export function drawnCell(index: number, columns: number, first: number, end: number, count: number): boolean {
  if (index < 0 || index >= count) return false
  const row = Math.floor(index / Math.max(1, columns))
  return row >= first && row < end
}

/**
 * What Enter in the search field picks: the active cell of the list on screen
 * (`{ list }`), the best hit of what the field says now when the list is a
 * key behind (`{ set }`, an index into the whole set), or nothing. A blank
 * field with no active cell picks NOTHING (review, 2026-10-31): an Enter on
 * open gave the folder the Home glyph, the set's first.
 */
export function enterPick({
  query,
  deferred,
  active,
  best
}: {
  query: string
  deferred: string
  active: number
  /** The set index of the best hit for a query. */
  best: (query: string) => number | undefined
}): { list: number } | { set: number } | null {
  if (query === deferred && active >= 0) return { list: active }
  if (!query.trim()) return null
  const hit = best(query)
  return hit === undefined ? null : { set: hit }
}
