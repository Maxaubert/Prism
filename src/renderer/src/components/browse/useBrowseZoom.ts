import { useLayoutEffect, useRef, type RefObject } from 'react'
import {
  explorerZoom,
  setExplorerZoom,
  ZOOM_MAX_AVAILABLE,
  zoomIn,
  zoomOut
} from '../../lib/explorerZoom'
import { anchorAt, anchorScroll, type Anchor } from '../../lib/zoomAnchor'
import { createZoomWheel } from '../../lib/zoomWheel'
import { GRID_GAP, GRID_PAD } from '../../lib/gridLayout'
import type { BrowseListProps } from './listProps'
import type { useBrowseSweep } from './useBrowseSweep'

export type ZoomIn = {
  props: BrowseListProps
  scrollerRef: RefObject<HTMLDivElement | null>
  geometry: ReturnType<typeof useBrowseSweep>['geometry']
  logicalTopAt: (top: number) => number
  ownScroll: (node: HTMLDivElement, top: number) => void
  handUp: (top: number) => void
  measured: RefObject<boolean>
  gridOn: boolean
  count: number
  scale: number
  rowHeight: number
  cols: number
  lead: number
  logicalTop: number
  zoomStep: number
}

/** ZOOM anchoring: the item under the pointer stays under it across a step. */
export function useBrowseZoom(a: ZoomIn) {
  const {
    props,
    scrollerRef,
    geometry,
    logicalTopAt,
    ownScroll,
    handUp,
    measured,
    gridOn,
    count,
    scale,
    rowHeight,
    cols,
    lead,
    logicalTop,
    zoomStep
  } = a
  /**
   * ZOOM (2026-11-09). Ctrl+wheel, a pinch and Ctrl+Plus/Minus/0 change the
   * step; the row under the pointer stays under it (zoomAnchor.ts). The item
   * and where the pointer is in it are noted BEFORE the step changes, and the
   * layout effect below scrolls to put it back before anything paints.
   */
  const zoomPending = useRef<(Anchor & { pointerY: number; boxTop: number }) | null>(null)
  const zoomTo = useRef<(next: number, pointerY: number | null, pointerX?: number) => void>(
    () => {}
  )
  useLayoutEffect(() => {
    zoomTo.current = (next, pointerY, pointerX) => {
      const node = scrollerRef.current
      const g = geometry.current
      if (!node || next === explorerZoom()) return
      if (g.count > 0) {
        const box = node.getBoundingClientRect()
        let y = pointerY
        let anchor: Anchor | null = null
        if (y === null) {
          // From the keyboard: the focused row stays put, else the first one in view.
          const at = document.activeElement?.closest<HTMLElement>('[data-browse-index]')
          const top = at && node.contains(at) ? at.getBoundingClientRect().top - box.top : -1
          if (at && top >= 0 && top < node.clientHeight) {
            y = top
            anchor = { index: Number(at.dataset.browseIndex), within: 0 }
          } else y = 0
        }
        // In a grid the column under the pointer picks the item in its line.
        const col =
          g.layout && pointerX !== undefined
            ? Math.floor((pointerX - GRID_PAD) / (g.layout.cellW + GRID_GAP))
            : 0
        anchor ??= anchorAt({
          top: logicalTopAt(node.scrollTop),
          pointerY: y,
          cellH: g.rowHeight,
          count: g.count,
          cols: g.cols,
          col,
          lead: g.lead
        })
        zoomPending.current = { ...anchor, pointerY: y, boxTop: box.top }
      }
      setExplorerZoom(next)
    }
  })
  /** Items are there to place: a listing that is empty or still loading has no
   *  layout to keep (a pane toggle re-reads the folder; the scroll must not be
   *  measured, or handed up, while it is empty). */
  const settled = count > 0 && !props.loading
  /** Last settled commit's top and shape, for the layout effect below: a width
   *  that changes the columns keeps the first item in view. */
  const lastShape = useRef({ rowHeight, cols, lead, top: 0, measured: false })
  useLayoutEffect(() => {
    const pending = zoomPending.current
    zoomPending.current = null
    const node = scrollerRef.current
    const prev = lastShape.current
    if (!node) return
    if (pending) {
      // Logical coordinates, then back through the compression, as the keys do.
      // The list itself can move: Large's header band is taller than Medium's
      // (MEASURED, 4px), so the pointer is that much nearer the list's top.
      const pointerY = pending.pointerY - (node.getBoundingClientRect().top - pending.boxTop)
      const target = anchorScroll({
        ...pending,
        pointerY,
        cellH: rowHeight,
        count,
        viewH: node.clientHeight,
        cols,
        lead
      })
      ownScroll(node, target / scale)
      handUp(node.scrollTop)
    } else if (
      gridOn &&
      settled &&
      prev.measured &&
      measured.current &&
      prev.cols !== cols &&
      prev.rowHeight === rowHeight &&
      prev.lead === lead
    ) {
      // The preview pane or the window changed the width and with it the
      // columns: the first item in view (as the last frame had it) stays there.
      const a = anchorAt({
        top: prev.top,
        pointerY: 0,
        cellH: rowHeight,
        count,
        cols: prev.cols,
        lead
      })
      ownScroll(
        node,
        anchorScroll({
          ...a,
          pointerY: 0,
          cellH: rowHeight,
          count,
          viewH: node.clientHeight,
          cols,
          lead
        }) / scale
      )
      handUp(node.scrollTop)
    }
    // When the cells' size or count per line changed (the zoom, or the width,
    // having landed), and on every step: a step that changes no cell (a zip at
    // a tile step keeps 40px rows) still consumes what it noted, or the next
    // listing would be scrolled by it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight, cols, settled, zoomStep])
  useLayoutEffect(() => {
    if (settled)
      lastShape.current = { rowHeight, cols, lead, top: logicalTop, measured: measured.current }
  })
  useLayoutEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    const wheel = createZoomWheel()
    const onZoomWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return
      // Chromium's own page zoom never fires over the list.
      event.preventDefault()
      const step = explorerZoom()
      const steps = wheel.feed(event, performance.now(), {
        zoomIn: step < ZOOM_MAX_AVAILABLE,
        zoomOut: step > 0
      })
      if (steps) {
        const box = node.getBoundingClientRect()
        zoomTo.current(
          steps > 0 ? zoomIn(step) : zoomOut(step),
          event.clientY - box.top,
          event.clientX - box.left + node.scrollLeft
        )
      }
    }
    node.addEventListener('wheel', onZoomWheel, { passive: false })
    return () => node.removeEventListener('wheel', onZoomWheel)
  }, [scrollerRef])
  return zoomTo
}
