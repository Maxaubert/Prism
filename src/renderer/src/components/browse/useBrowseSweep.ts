import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import { bandBox, nearestRow, rowsInBox } from '../../lib/marquee'
import { cellSpan, cellsInBox, nearestCell } from '../../lib/cellsInBox'
import type { GridLayout } from '../../lib/gridLayout'
import { useSweep } from '../../hooks/useSweep'
import type { BrowseEntry } from './types'
import type { BrowseListProps } from './listProps'
import type { Hand } from './useBrowseScroll'

export type SweepIn = {
  props: BrowseListProps
  scrollerRef: RefObject<HTMLDivElement | null>
  handRef: RefObject<Hand>
  rowAt: (index: number) => BrowseEntry | null | undefined
  count: number
  spaceHeight: number
  height: number
  scale: number
  rowHeight: number
  contentH: number
  cols: number
  lead: number
  layout: GridLayout | null
}

/** THE SWEEP and the marks it draws (see the note below), and the list's
 *  geometry as the pointer events read it. */
export function useBrowseSweep(a: SweepIn) {
  const {
    props,
    scrollerRef,
    handRef,
    rowAt,
    count,
    spaceHeight,
    height,
    scale,
    rowHeight,
    contentH,
    cols,
    lead,
    layout
  } = a
  /**
   * THE SWEEP (#257). From the list's blank space a drag draws the rectangle
   * and marks every row it touches, live. Rows are found by index, never by
   * element: only the rows in view exist, and a row scrolled away under the
   * rectangle is still in it.
   *
   * THE WHOLE ROW IS THE FILE'S (#320; owner, 2026-10-07: "its not possible
   * to pick up items unless you left click drag when hovering over the file
   * name. the whole row should let me left click drag ... that drag should
   * only be from empty spaces either under or beside the file row"). Until
   * then a row's Type, Size and Date cells swept. Now a press anywhere on a
   * row drags it, and the sweep starts only off the rows: under the last one,
   * or beside them, since a row ends where its last column does and a gutter
   * is always left on the right (browse.css), File Explorer's Details view.
   */
  const [sweeping, setSweeping] = useState<{ paths: string[]; add: boolean } | null>(null)
  const sweepAdd = useRef(false)
  const geometry = useRef({
    count,
    spaceHeight,
    height,
    scale,
    rowHeight,
    contentH,
    cols,
    lead,
    layout
  })
  const rowAtRef = useRef(rowAt)
  // Mirrored after render (refs are not written while rendering); the sweep
  // reads them from pointer events, which only come after.
  useLayoutEffect(() => {
    geometry.current = {
      count,
      spaceHeight,
      height,
      scale,
      rowHeight,
      contentH,
      cols,
      lead,
      layout
    }
    rowAtRef.current = rowAt
  })
  /** The list's top, in row coordinates, for a scroll position: the rule the
   *  render uses, so the rectangle and the rows agree when the list is huge. */
  const logicalTopAt = (top: number): number => {
    const g = geometry.current
    return top >= g.spaceHeight - g.height - 1 ? Math.max(0, g.contentH - g.height) : top * g.scale
  }
  const sweep = useSweep({
    scroller: () => scrollerRef.current,
    // Read at the press and after a scroll only (#332): never per move.
    measure: () => {
      const node = scrollerRef.current
      if (!node) return null
      const r = node.getBoundingClientRect()
      return {
        left: r.left,
        top: r.top,
        scrollTop: node.scrollTop,
        scrollLeft: node.scrollLeft,
        scrollWidth: node.scrollWidth,
        // The visible rows, in the page's client: the native box's clip (#338).
        clip: {
          left: r.left + node.clientLeft,
          top: r.top + node.clientTop,
          right: r.left + node.clientLeft + node.clientWidth,
          bottom: r.top + node.clientTop + node.clientHeight
        }
      }
    },
    toList: (x, y, m) => {
      const g = geometry.current
      return {
        x: Math.min(m.scrollWidth, Math.max(0, x - m.left + m.scrollLeft)),
        y: Math.max(
          0,
          Math.min(Math.max(g.contentH, g.height), logicalTopAt(m.scrollTop) + y - m.top)
        )
      }
    },
    // toList's inverse, with the same compressed-scroll rule (logicalTopAt).
    fromList: (p, m) => ({
      x: p.x - m.scrollLeft + m.left,
      y: p.y - logicalTopAt(m.scrollTop) + m.top
    }),
    clipOf: (m) => m.clip,
    place: (band, m) => {
      // Row coordinates to the scroll box's own: the rows sit at
      // scrollTop + (y - logicalTop). Clamped to what is in view, so a sweep
      // across a hundred thousand rows is still one small element. From the
      // measured scroll, not the rendered one, so it holds while the list
      // auto-scrolls under it. Known and accepted: in the compressed scroll
      // (`scale > 1`, about 180k rows and up) the rows are placed from the
      // RENDERED `liveTop`, a frame later, so while the list
      // auto-scrolls there the box and the rows can disagree for a frame by
      // the scroll step times `scale - 1`. Below that `logicalTopAt(s) === s`.
      const b = bandBox(band)
      const top = m.scrollTop + b.top - logicalTopAt(m.scrollTop)
      const lo = Math.max(top, m.scrollTop - 2)
      const hi = Math.min(top + b.height, m.scrollTop + geometry.current.height + 2)
      return { x0: b.left, x1: b.left + b.width, y0: lo, y1: Math.max(lo, hi) }
    },
    rowAcross: () => {
      // A grid's tiles are found by their cells, never by a drawn row.
      if (geometry.current.layout) return { left: 0, right: scrollerRef.current?.scrollWidth ?? 0 }
      // What is drawn as a row across (#326): the list's left to the end of
      // its last column, a gutter short of the edge (#320), measured off any
      // row in view, since every row is the one grid. A row out of view is
      // the same width, so it is still hit by its index.
      const node = scrollerRef.current
      const drawn = node?.querySelector<HTMLElement>('.browse-row-layer > .browse-row')
      if (!node || !drawn) return null
      const r = node.getBoundingClientRect()
      const d = drawn.getBoundingClientRect()
      return { left: d.left - r.left + node.scrollLeft, right: d.right - r.left + node.scrollLeft }
    },
    hitsIn: (box, py, drawnAcross, px) => {
      const g = geometry.current
      if (g.layout) {
        // THE GRID'S SWEEP (Stage 6): the tiles whose rect the box touches,
        // by the columns and lines it spans (cellsInBox), so a box over a gap
        // marks nothing and ten thousand tiles cost the lines crossed.
        const span = cellSpan(box, g.layout)
        if (!span) return { paths: [], near: null }
        const paths: string[] = []
        for (const i of cellsInBox(box, g.layout)) {
          const entry = rowAtRef.current(i)
          if (entry) paths.push(entry.path)
        }
        const near = rowAtRef.current(nearestCell(g.layout, px ?? box.right, py, span))
        return { paths, near: near?.path ?? paths[paths.length - 1] ?? null }
      }
      const across = drawnAcross ?? { left: 0, right: scrollerRef.current?.scrollWidth ?? 0 }
      const span = rowsInBox(box, { ...across, height: g.rowHeight }, g.count)
      if (!span) return { paths: [], near: null }
      const paths: string[] = []
      for (let i = span.first; i <= span.last; i++) {
        const entry = rowAtRef.current(i)
        if (entry) paths.push(entry.path)
      }
      const near = rowAtRef.current(nearestRow(py, g.rowHeight, span.first, span.last))
      return { paths, near: near?.path ?? paths[paths.length - 1] ?? null }
    },
    scrollBy: (dy) => {
      const node = scrollerRef.current
      if (!node) return
      // The sweep's autoscroll is the hand's: the pointer at the edge asks it.
      handRef.current.at = performance.now()
      node.scrollTop += dy / geometry.current.scale
    },
    onChange: (paths) => setSweeping({ paths, add: sweepAdd.current }),
    onEnd: (paths, near) => {
      setSweeping(null)
      props.onSweep?.(paths, near, sweepAdd.current)
    },
    onCancel: () => setSweeping(null)
  })
  const onListPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || props.loading || props.message || !props.onSweep) return
    // A file's row or tile, every part of it: its own drag. The sweep starts
    // on blank space only: a grid's gaps, its right margin, under the last line.
    if (
      (e.target as HTMLElement).closest(
        '.browse-row[data-browse-path], .browse-tile[data-browse-path]'
      )
    )
      return
    sweepAdd.current = e.ctrlKey
    sweep.begin(e)
  }
  /** What reads as marked: the sweep in progress (plus, for Ctrl, what was
   *  marked before it), else the selection FolderBrowser holds. */
  const shownMarks: ReadonlySet<string> | null = sweeping
    ? new Set([
        ...(sweeping.add ? (props.marked ?? (props.selectedPath ? [props.selectedPath] : [])) : []),
        ...sweeping.paths
      ])
    : (props.marked ?? null)
  const isMarked = (path: string): boolean =>
    shownMarks ? shownMarks.has(path) : path === props.selectedPath
  return { geometry, logicalTopAt, sweep, onListPointerDown, isMarked }
}
