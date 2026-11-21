import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createScrollSettle } from '../../lib/scrollSettle'
import type { divideRows } from '../../lib/dateGroups'
import type { GridLayout } from '../../lib/gridLayout'
import type { BrowseEntry } from './types'
import type { BrowseListProps } from './listProps'

/** How long after the hand's last input (a wheel notch, a sweep's step) a
 *  scroll still counts as the hand's: a wheel's smooth scroll runs on after it. */
export const HAND_MS = 800

/** The hand's last scrolling input, and a scroll it is holding (the
 *  scrollbar's thumb, a finger, the middle button's autoscroll). */
export type Hand = { at: number; hold: 'bar' | 'touch' | 'auto' | null }

/** A path's row in the list as drawn (dividers counted), or -1. */
export function rowIndexOf(
  path: string | null | undefined,
  entries: readonly BrowseEntry[],
  indexedRows: Map<number, BrowseEntry | null> | undefined,
  divided: ReturnType<typeof divideRows> | null
): number {
  if (!path) return -1
  if (indexedRows) {
    for (const [index, entry] of indexedRows) if (entry?.path === path) return index
    return -1
  }
  const at = entries.findIndex((entry) => entry.path === path)
  return divided && at >= 0 ? divided.rowOf(at) : at
}

/** The list's live scroll position and its restore from the tab. */
export function useLiveScroll(
  props: BrowseListProps,
  scrollerRef: RefObject<HTMLDivElement | null>
) {
  /**
   * THE LIVE SCROLL IS THE LIST'S OWN (review, 2026-10-16). Every native
   * scroll event used to patch the tab, which re-rendered the whole App,
   * re-sorted the folder and sent every tab's history to main, per frame.
   * Now a scroll re-renders this list alone, and the position is handed up
   * once it settles (lib/scrollSettle.ts) or at once for a key's move. The
   * tab's `scrollTop` is taken over only when it changes from outside (a
   * restore, a sort's reset, Back) or the place on screen does; one this list
   * handed up itself is already where it is (`from`), so the list never
   * jumps back to a position a frame old.
   */
  const placeKey = `${props.directory}\u0000${props.query}\u0000${props.sort.key}${props.sort.direction}`
  const [liveState, setLive] = useState(() => ({
    key: placeKey,
    from: props.scrollTop,
    top: props.scrollTop,
    taken: 0
  }))
  let live = liveState
  if (live.key !== placeKey || live.from !== props.scrollTop) {
    live = { key: placeKey, from: props.scrollTop, top: props.scrollTop, taken: live.taken + 1 }
    setLive(live)
  }
  const [settle] = useState(createScrollSettle)
  useEffect(() => () => settle.flush(), [settle])
  const handOwner = useRef(props.onScroll)
  useLayoutEffect(() => {
    handOwner.current = props.onScroll
  })
  /** The list scrolled itself: re-render this list, hand it up when it settles. */
  const scrolledTo = (top: number): void => {
    setLive((l) => (l.top === top ? l : { ...l, top }))
    const up = props.onScroll
    const key = placeKey
    settle.scrolled(up, top, (settled) => {
      setLive((l) => (l.key === key && handOwner.current === up ? { ...l, from: settled } : l))
      up(settled)
    })
  }
  /** A key moved the list: hand the position up at once. */
  const handUp = (top: number): void => {
    settle.cancel()
    setLive((l) => ({ ...l, top, from: top }))
    props.onScroll(top)
  }
  /** Where the list's OWN last scroll put it (a restore, a zoom's anchor, a
   *  reveal, a follow): the scroll event that lands there is never the hand's,
   *  whatever input came just before it. */
  const ownRef = useRef<number | null>(null)
  /** Set the scroll as the list's own move. */
  const ownScroll = (node: HTMLDivElement, top: number): void => {
    node.scrollTop = top
    ownRef.current = node.scrollTop
  }
  const liveTop = live.top
  useLayoutEffect(() => {
    const node = scrollerRef.current
    if (!node || props.loading) return
    ownScroll(node, live.top)
    // A POSITION THE FOLDER CANNOT REACH IS NOT KEPT (owner, 2026-11-14, a
    // screenshot: Back to a zip's 20 rows drew them eight rows down under a
    // blank band). Back puts a place's saved scroll back, but a folder that
    // now fits (a taller window, a smaller zoom) clamps it to where it can go,
    // and when the list was already there no scroll event says so: the rows
    // were drawn at the saved position. They are drawn where the list IS.
    const at = node.scrollTop
    if (Math.abs(at - live.top) > 1)
      setLive((l) => (l.taken === live.taken ? { ...l, top: at } : l))
    // Only when a position is TAKEN from the tab (or the load ends), never
    // per scroll: the list is already where it scrolled to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.taken, props.loading])
  return { placeKey, live, liveTop, ownRef, ownScroll, scrolledTo, handUp }
}

export type FollowIn = {
  props: BrowseListProps
  scrollerRef: RefObject<HTMLDivElement | null>
  handRef: RefObject<Hand>
  ownRef: RefObject<number | null>
  ownScroll: (node: HTMLDivElement, top: number) => void
  handUp: (top: number) => void
  live: { taken: number; top: number }
  placeKey: string
  cursor: string | null
  divided: ReturnType<typeof divideRows> | null
  loadedSelectedIndex: number
  indexOfPath: (path: string) => number
  count: number
  scale: number
  layout: GridLayout | null
  cols: number
  lead: number
  rowHeight: number
  height: number
  width: number
  zoomStep: number
}

/** Scroll a row into view, bring a requested row into view, and keep the
 *  selection in view unless the hand scrolled away (see the long note below). */
export function useBrowseFollow(a: FollowIn) {
  const {
    props,
    scrollerRef,
    handRef,
    ownRef,
    ownScroll,
    handUp,
    live,
    placeKey,
    cursor,
    divided,
    loadedSelectedIndex,
    indexOfPath,
    count,
    scale,
    layout,
    cols,
    lead,
    rowHeight,
    height,
    width,
    zoomStep
  } = a
  // Where an item's cell starts and ends in the scrolled space. In a grid the
  // first line starts at 0 (its padding shows) and the last ends with its
  // padding; in a list `lead` is 0 and a cell is a row.
  const cellTop = (i: number): number =>
    layout && i < cols ? 0 : lead + Math.floor(i / cols) * rowHeight
  const cellBottom = (i: number): number => {
    const line = Math.floor(i / cols)
    return (
      lead +
      line * rowHeight +
      (layout ? layout.cellH + (line === layout.rows - 1 ? lead : 0) : rowHeight)
    )
  }
  const scrollToRow = (node: HTMLDivElement, index: number): void => {
    const top = cellTop(divided?.divider(index - 1) ? index - 1 : index)
    const bottom = cellBottom(index)
    const visibleTop = node.scrollTop * scale
    if (top < visibleTop) ownScroll(node, top / scale)
    else if (bottom > visibleTop + node.clientHeight)
      ownScroll(node, (bottom - node.clientHeight) / scale)
    handUp(node.scrollTop)
  }
  // WHAT AN ACTION MADE COMES INTO VIEW (#101), once per request.
  const revealedSeq = useRef(0)
  useLayoutEffect(() => {
    const want = props.revealPath
    const node = scrollerRef.current
    if (!want || want.seq === revealedSeq.current || !node || props.loading) return
    const index = indexOfPath(want.path)
    if (index < 0) return
    revealedSeq.current = want.seq
    scrollToRow(node, index)
  })
  /**
   * THE LIST FOLLOWS THE SELECTION (owner, 2026-11-12: "i always want the
   * selcted file unless i scroll awayu form it manually to always be in view,
   * if i use the arrow keys to navigate when somethign not in view, the next
   * one shoudl bring me back"). Whenever the selected row (or the keyboard's
   * cursor, while the Ctrl keys hold it apart) would be out of view, for any
   * reason, it is scrolled minimally into view, at the nearest edge, as the
   * arrows do: a selection set from outside (a file opened by its path, a
   * link, Win+E, back from the viewer in rows and the grid alike, the next
   * row after a delete, an undo, a paste landing), and the view changing
   * under a selection that stays (the listing arriving or refreshing, rows
   * inserted above it, a sort, a zoom step, list to grid, a resize).
   *
   * THE HAND WINS. Once the user scrolls by hand (the wheel or a touchpad,
   * the scrollbar's thumb, a finger, the middle button's autoscroll, a
   * sweep's autoscroll) so that the selection leaves the view, following
   * stops until the selection CHANGES (an arrow, a click, a pick from
   * outside). The hand is told apart from the list's own scrolls by its
   * INPUT, never by the scroll event: a scroll counts as the hand's while one
   * of those inputs holds it or for HAND_MS after the last of them, unless it
   * lands where the list's own last write put it (`own`). Scrolling back to
   * the selection by hand follows again. The hand's choice is remembered per
   * tab and place (`handLeft`), so a tab switch or Back that puts the same
   * position back does not snap to the selection either.
   *
   * Cheap: the index is walked only when the selection or the listing
   * changes (`rowIndexOf`, memoized), and a scroll asks a sum or two.
   */
  const followPath = cursor ?? props.selectedPath ?? null
  const cursorIndex = useMemo(
    () => (cursor === null ? -1 : rowIndexOf(cursor, props.entries, props.indexedRows, divided)),
    [cursor, props.entries, props.indexedRows, divided]
  )
  const followIndex = cursor !== null ? cursorIndex : loadedSelectedIndex
  /** The row at `index` is wholly inside the list's box. */
  const cellInView = (node: HTMLDivElement, index: number): boolean => {
    const visibleTop = node.scrollTop * scale
    return (
      cellTop(index) >= visibleTop - 1 && cellBottom(index) <= visibleTop + node.clientHeight + 1
    )
  }
  const detached = useRef(false)
  /** The tab and the place on screen (one list serves every tab). */
  const viewKey = `${props.tabId ?? ''}\u0000${placeKey}`
  /**
   * Where the hand LEFT a selection out of view, per tab and place: a tab
   * switch, Back or Forward that puts that same position back is still the
   * hand's choice and is not followed. Any other position (a new history
   * entry, a sort's reset) follows again.
   */
  const handLeft = useRef(new Map<string, { path: string; top: number }>())
  /** The selection, the place and the restore the follow last judged. */
  const followed = useRef<{ view: string; path: string | null; taken: number } | null>(null)
  /** Ctrl+A dropped the Ctrl cursor: the selection it falls back to is no new pick. */
  const cursorDropped = useRef(false)
  const followNow = useRef({
    index: followIndex,
    inView: cellInView,
    path: followPath,
    view: viewKey
  })
  useLayoutEffect(() => {
    followNow.current = { index: followIndex, inView: cellInView, path: followPath, view: viewKey }
  })
  /** The selection is out of view by the user's own doing: keep it that way here. */
  const leave = (node: HTMLDivElement, view: string, path: string | null, away: boolean): void => {
    detached.current = away
    if (away && path) handLeft.current.set(view, { path, top: node.scrollTop })
    else handLeft.current.delete(view)
  }
  /** A scroll event: the hand's, it decides whether the list still follows. */
  const scrollFollow = (node: HTMLDivElement): void => {
    const mine = ownRef.current
    if (mine !== null && Math.abs(node.scrollTop - mine) < 1) return
    ownRef.current = null
    const h = handRef.current
    if (!h.hold && performance.now() - h.at > HAND_MS) return
    const { index, inView, path, view } = followNow.current
    leave(node, view, path, index >= 0 && !inView(node, index))
  }
  useLayoutEffect(() => {
    const node = scrollerRef.current
    const area = node?.closest<HTMLElement>('.browse-list-area')
    if (!node || !area) return
    const now = (): number => performance.now()
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) handRef.current = { at: now(), hold: null }
    }
    const onDown = (e: PointerEvent): void => {
      const h = handRef.current
      // A press ends the middle button's autoscroll (Chromium's own), and
      // that press is the hand's too.
      if (h.hold === 'auto') handRef.current = { at: now(), hold: null }
      const at = e.target as HTMLElement
      if (at.closest('.browse-overlay-scroll')) handRef.current = { at: now(), hold: 'bar' }
      else if (!node.contains(at)) return
      else if (e.pointerType === 'touch') handRef.current = { at: now(), hold: 'touch' }
      else if (e.button === 1) handRef.current = { at: now(), hold: 'auto' }
    }
    const onUp = (): void => {
      const h = handRef.current
      // A finger's fling runs on after it lifts.
      if (h.hold === 'bar') handRef.current = { at: now(), hold: null }
      else if (h.hold === 'touch') handRef.current = { at: now() + 1200, hold: null }
    }
    const onKey = (): void => {
      if (handRef.current.hold === 'auto') handRef.current = { at: now(), hold: null }
    }
    const onDragOver = (): void => {
      handRef.current = { ...handRef.current, at: now() }
    }
    node.addEventListener('wheel', onWheel, { passive: true, capture: true })
    node.addEventListener('dragover', onDragOver, { passive: true })
    area.addEventListener('pointerdown', onDown, { capture: true })
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      node.removeEventListener('wheel', onWheel, { capture: true })
      node.removeEventListener('dragover', onDragOver)
      area.removeEventListener('pointerdown', onDown, { capture: true })
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [handRef, scrollerRef])
  // After the tab's own scroll is put back (the effect at the top) and after
  // a zoom's anchor: neither is fought while the selection is in view anyway.
  useLayoutEffect(() => {
    const node = scrollerRef.current
    const was = followed.current
    if (!was || was.view !== viewKey || was.taken !== live.taken) {
      // A place shown again (a tab switch, Back, the tab's scroll put back):
      // the position the hand left this same selection out of view at is
      // kept; anything else follows.
      const left = handLeft.current.get(viewKey)
      detached.current = !!left && left.path === followPath && Math.abs(left.top - live.top) <= 1
      if (!detached.current) handLeft.current.delete(viewKey)
    } else if (was.path !== followPath) {
      // A new selection: the list follows again, whatever the hand did. Ctrl+A
      // letting go of the Ctrl cursor picks nothing new: the row the selection
      // was already on is not scrolled to.
      if (cursorDropped.current && node)
        leave(node, viewKey, followPath, followIndex >= 0 && !cellInView(node, followIndex))
      else {
        detached.current = false
        handLeft.current.delete(viewKey)
      }
    }
    cursorDropped.current = false
    followed.current = { view: viewKey, path: followPath, taken: live.taken }
    if (!node || props.loading || props.message || detached.current || followIndex < 0) return
    if (followIndex >= count) return
    if (!cellInView(node, followIndex)) scrollToRow(node, followIndex)
    // cellInView and scrollToRow read this render's geometry, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewKey,
    followPath,
    followIndex,
    count,
    rowHeight,
    cols,
    lead,
    height,
    width,
    scale,
    zoomStep,
    live.taken,
    props.loading,
    props.message
  ])
  return { scrollToRow, scrollFollow, cursorIndex, cursorDropped }
}
