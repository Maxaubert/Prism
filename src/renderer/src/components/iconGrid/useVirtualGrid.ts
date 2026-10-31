import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'
import { columnsFor, rowCount, scrollFor, visibleRows } from './gridMath'

/**
 * A WINDOWED GRID (folder icons, 2026-10-31; owner: "the list needs to be
 * optimized so it wont lag while scrolling the list"). The scroller's width
 * gives the columns (a ResizeObserver), its scroll position the band of rows
 * in the DOM. React renders again only when the BAND changes, not on every
 * scroll event, so a wheel through 200 rows re-renders a few dozen times and
 * the DOM holds about 10 rows of cells throughout.
 */
export function useVirtualGrid(
  ref: RefObject<HTMLDivElement | null>,
  count: number,
  cell: number
): {
  columns: number
  rows: number
  first: number
  end: number
  /** Bring a cell's row into view. */
  reveal: (index: number) => void
  /** How many whole rows one screen holds (PageUp / PageDown). */
  pageRows: number
} {
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [band, setBand] = useState({ first: 0, end: 0 })
  const columns = columnsFor(box.width, cell)
  const rows = rowCount(count, columns)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const next = visibleRows(el.scrollTop, el.clientHeight, cell, rowCount(count, columnsFor(el.clientWidth, cell)))
    setBand((b) => (b.first === next.first && b.end === next.end ? b : next))
  }, [cell, count, ref])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const size = (): void => {
      setBox((b) =>
        b.width === el.clientWidth && b.height === el.clientHeight
          ? b
          : { width: el.clientWidth, height: el.clientHeight }
      )
      measure()
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', measure)
    }
  }, [measure, ref])

  const reveal = useCallback(
    (index: number) => {
      const el = ref.current
      if (!el || index < 0) return
      const cols = columnsFor(el.clientWidth, cell)
      const top = scrollFor(index, cols, cell, el.scrollTop, el.clientHeight)
      if (top !== el.scrollTop) el.scrollTop = top
      measure()
    },
    [cell, measure, ref]
  )

  return {
    columns,
    rows,
    first: Math.min(band.first, rows),
    end: Math.min(band.end, rows),
    reveal,
    pageRows: Math.max(1, Math.floor(box.height / cell))
  }
}
