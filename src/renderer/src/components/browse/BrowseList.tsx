import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX
} from 'react'
import { useFileCut } from '../../lib/fileClipboard'
import { SweepBand } from './SweepBand'
import { BusyBar } from './BusyBar'
import { useFolderIcons } from '../../lib/folderIcons'
import { OverlayScrollbar } from './OverlayScrollbar'
import { explorerHeadVars } from '../../lib/explorerSize'
import { atStep, headSizeOf, useExplorerZoom } from '../../lib/explorerZoom'
import { GRID_PAD, gridLayout, rowsWindow } from '../../lib/gridLayout'
import { gridHeaderColumns } from '../../lib/gridHeader'
import { useFolderDrop } from './useFolderDrop'
import type { BrowseEntry } from './types'
import { divideRows } from '../../lib/dateGroups'
import { tierFor } from '@shared/thumbTypes'
import { visibleWants } from '../../lib/thumbKind'
import { useDocumentShown, useThumbFeed } from '../../lib/useThumbs'
import { BrowseColumnHeader } from './BrowseColumnHeader'
import { headerColumnsFor } from './browseColumns'
import { type EntryPictures } from './EntryMedia'
import { BrowseGrid } from './BrowseGrid'
import { layerShift } from '../../lib/layerShift'
import { entryRows, entryTile, type EntryView } from './BrowseEntry'
import type { BrowseListProps } from './listProps'
import { rowIndexOf, useBrowseFollow, useLiveScroll, type Hand } from './useBrowseScroll'
import { useBrowseSweep } from './useBrowseSweep'
import { useBrowseZoom } from './useBrowseZoom'
import { useBrowseKeys } from './useBrowseKeys'

const OVERSCAN = 12
export function BrowseList(props: BrowseListProps): JSX.Element {
  const cut = useFileCut()
  // The bin takes no drop at all (D16): the handler is absent, so every
  // target says "no" explicitly (useFolderDrop).
  const folderDrop = useFolderDrop(
    props.loading || props.bin ? undefined : props.onDropInto,
    props.archive
  )
  // There is no search in the bin (D11): a query carried in never shows as one.
  const searching = !!props.query.trim() && !props.bin
  // The row is Settings > Style > Explorer size: Medium is the tree's own row
  // (#257), Large the Explorer's old one, Small a step under Medium.
  // Ctrl+wheel moves the zoom step (2026-11-09); steps 0 to 2 are those
  // sizes, 3 and up the roomier rows. The header and the size-specific CSS
  // keep Large's from step 2 up.
  const zoomStep = useExplorerZoom()
  const look = atStep(zoomStep)
  const sizeId = headSizeOf(zoomStep)
  // Folder icons (2026-10-31): one read for the list; with none set a row
  // does no lookup at all, and file rows never do.
  const folderIcons = useFolderIcons()
  /**
   * THE GRID (zoom steps 5 to 9, Stage 4): a plain folder listing at a tile
   * step is drawn as tiles. A search, an Everything window or an archive's
   * members keep rows (Large's 40px at a tile step). The grid is a different
   * arrangement of the same entries, so the list's arithmetic is kept: a
   * "line" is a row of cells (`cols` items, one in a list) `rowHeight` tall,
   * `lead` px of padding sit above the first and below the last, and a
   * pending index is still an index into the entries.
   */
  const gridOn = look.kind === 'tile' && !searching && !props.archive && !props.indexedRows
  const scroller = useRef<HTMLDivElement>(null)
  const columnScroller = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(600)
  const [width, setWidth] = useState(800)
  const layout = useMemo(
    () =>
      gridOn
        ? gridLayout({ width, count: props.total, edge: look.edge, font: look.tileFont })
        : null,
    [gridOn, width, props.total, look.edge, look.tileFont]
  )
  const cols = layout?.cols ?? 1
  const rowHeight = layout ? layout.pitch : look.height
  const lead = layout ? GRID_PAD : 0
  const typed = useRef({ text: '', at: 0 })
  /** The row the first press of a double-click was on (#494). */
  const firstPress = useRef<string | null>(null)
  const pendingFocus = useRef<number | null>(null)
  const selectionPosition = useRef({ path: '', index: -1 })
  /** The list has been measured once: before that its width is a guess. */
  const measured = useRef(false)
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    // Measured before the first paint, so a grid opens with its real columns
    // and a remembered scroll is not moved by a width that arrives later.
    setHeight(node.clientHeight)
    setWidth(node.clientWidth)
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height)
      setWidth(entry.contentRect.width)
      // From the observer's first answer on, a width that changes the columns
      // is a real resize (a dragged pane), not the guess being corrected.
      measured.current = true
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const { placeKey, live, liveTop, ownRef, ownScroll, scrolledTo, handUp } = useLiveScroll(
    props,
    scroller
  )
  // DOWNLOADS' DATE GROUPS (#285): a divider is a row of the list's own
  // height, so the rows below it simply move down one index; `rowAt` answers
  // null on it, which every walk of the list (arrows, Home and End, a pending
  // focus, the sweep) already steps over.
  // A grid draws no date groups: a full-width header between tile lines would
  // make the index-to-cell map irregular (the sort stays by date).
  const divided = useMemo(
    () =>
      props.dividers?.length && !props.indexedRows && !gridOn
        ? divideRows(props.entries.length, props.dividers)
        : null,
    [props.dividers, props.indexedRows, props.entries.length, gridOn]
  )
  const count = divided ? divided.length : props.total
  // The dividers are hidden from the listbox (its options are files), so each
  // row carries the name of its group for a screen reader instead.
  const groupOf = useMemo(() => {
    if (!divided || !props.dividers) return null
    const sorted = [...props.dividers].sort((x, y) => x.before - y.before)
    const out: string[] = new Array(props.entries.length)
    let k = -1
    for (let i = 0; i < props.entries.length; i++) {
      while (k + 1 < sorted.length && sorted[k + 1].before <= i) k++
      out[i] = k >= 0 ? sorted[k].label : ''
    }
    return out
  }, [divided, props.dividers, props.entries.length])
  // Chromium caps element dimensions. Compress only the offscreen space for
  // very large indexes; visible rows keep their normal size and hit targets.
  const lines = layout ? layout.rows : count
  const contentH = 2 * lead + lines * rowHeight
  const spaceHeight = Math.min(contentH, 4000000)
  const scale = Math.max(1, (contentH - height) / Math.max(1, spaceHeight - height))
  const logicalTop =
    liveTop >= spaceHeight - height - 1 ? Math.max(0, contentH - height) : liveTop * scale
  // A walk of the listing, so it is done when the selection or the listing
  // changes and never per scroll (a scroll re-renders this list, and a folder
  // can hold a hundred thousand entries).
  const loadedSelectedIndex = useMemo(
    () => rowIndexOf(props.selectedPath, props.entries, props.indexedRows, divided),
    [props.selectedPath, props.entries, props.indexedRows, divided]
  )
  const selectedIndex = loadedSelectedIndex
  useLayoutEffect(() => {
    if (loadedSelectedIndex >= 0 && props.selectedPath)
      selectionPosition.current = { path: props.selectedPath, index: loadedSelectedIndex }
  }, [loadedSelectedIndex, props.selectedPath])
  // The lines mounted: those in view and a margin of them (a list's twelve
  // rows, a grid's two lines of cells). `first` and `end` are LINES, and the
  // items mounted are from `firstItem` up to `endItem` (the same in a list).
  const shown = layout ? rowsWindow(layout, logicalTop, height, 2) : null
  const first = shown ? shown.firstRow : Math.max(0, Math.floor(logicalTop / rowHeight) - OVERSCAN)
  const end = shown
    ? shown.endRow
    : Math.min(count, Math.ceil((logicalTop + height) / rowHeight) + OVERSCAN)
  const firstItem = first * cols
  const endItem = Math.min(count, end * cols)
  const rowAt = (index: number): BrowseEntry | null | undefined => {
    if (props.indexedRows) return props.indexedRows.get(index)
    if (!divided) return props.entries[index]
    const at = divided.entryAt(index)
    return at === null ? null : props.entries[at]
  }
  const rendered = Array.from({ length: Math.max(0, endItem - firstItem) }, (_, index) =>
    rowAt(firstItem + index)
  )
  /**
   * PICTURES IN THE NAME COLUMN (zoom steps 3 and 4, Stage 3, 2026-11-09). The
   * mounted rows tell the feed which pictures they want; it asks main once the
   * list has settled (useThumbs.ts). Only a plain folder listing gets pictures:
   * a search, an Everything window or an archive's members keep their icons.
   * A loading-bar hold, a hidden window and a step below 3 ask for nothing.
   */
  const thumbFeed = useThumbFeed(props.tabId)
  const windowShown = useDocumentShown()
  // The picture's edge: a row step's box, or the tile's whole picture. The
  // tier follows it (tile edge x devicePixelRatio, thumbTypes.tierFor).
  const pictureEdge = gridOn ? look.edge : look.thumb
  // The bin never wears pictures (D8): its files are Windows' entries.
  const thumbsOn =
    pictureEdge > 0 && !searching && !props.archive && !props.bin && !props.indexedRows
  const thumbsActive = thumbsOn && !props.held && !props.loading && windowShown
  useEffect(() => {
    thumbFeed?.setActive(thumbsActive)
  }, [thumbFeed, thumbsActive])
  useEffect(() => {
    thumbFeed?.reset()
  }, [thumbFeed, props.directory])
  const landing = props.landing
  const wanted = thumbsActive
    ? visibleWants(
        rendered,
        tierFor(pictureEdge, window.devicePixelRatio),
        landing ? (p) => landing.has(p.toLowerCase()) : undefined
      )
    : []
  // After every render: the feed compares what is mounted and does nothing for
  // the same set, so a re-render that moved no row costs a string compare.
  useEffect(() => {
    thumbFeed?.visible(wanted)
  })
  /** The hand's last scrolling input, and a scroll it is holding. */
  const hand = useRef<Hand>({ at: -Infinity, hold: null })
  const { geometry, logicalTopAt, sweep, onListPointerDown, isMarked } = useBrowseSweep({
    props,
    scrollerRef: scroller,
    handRef: hand,
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
  })
  const onVisibleFolders = props.onVisibleFolders
  const onSearchRange = props.onSearchRange
  const indexed = !!props.indexedRows
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node || scale === 1) return
    const wheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.shiftKey || !event.deltaY) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? rowHeight : event.deltaMode === 2 ? height : 1
      node.scrollTop += (event.deltaY * unit) / scale
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => node.removeEventListener('wheel', wheel)
  }, [scale, height, rowHeight])
  useLayoutEffect(() => {
    if (indexed) onSearchRange?.(Math.floor(logicalTop / rowHeight))
  }, [indexed, logicalTop, onSearchRange, rowHeight])
  const zoomTo = useBrowseZoom({
    props,
    scrollerRef: scroller,
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
  })
  useLayoutEffect(() => {
    const top = Math.max(0, Math.floor((logicalTop - lead) / rowHeight)) * cols
    const visibleCount = (Math.ceil(height / rowHeight) + 1) * cols
    onVisibleFolders?.(
      indexed
        ? []
        : Array.from({ length: visibleCount }, (_, i) => {
            const row = top + i
            if (!divided) return props.entries[row]
            const at = divided.entryAt(row)
            return at === null ? undefined : props.entries[at]
          })
            .filter((entry) => entry?.isFolder)
            .map((entry) => entry!.path)
    )
  }, [props.entries, divided, logicalTop, height, onVisibleFolders, indexed, rowHeight, cols, lead])
  const onSelect = props.onSelect
  const onScroll = handUp
  const scrollTop = liveTop
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    const node = scroller.current
    if (pending === null || !count || !node) return
    let index = pending === Infinity ? count - 1 : Math.min(pending, count - 1)
    let entry = rowAt(index)
    const direction = pending === Infinity ? -1 : 1
    while (entry === null && index >= 0 && index < count) {
      index += direction
      entry = rowAt(index)
    }
    if (index < 0 || index >= count) {
      pendingFocus.current = null
      return
    }
    // The initiating key already positioned the scroll bar. A queued End
    // pressed before results existed needs one positioning pass, never a
    // repeated correction of fractional native scroll coordinates.
    if (pending === Infinity) {
      ownScroll(node, Math.max(0, (contentH - height) / scale))
      if (node.scrollTop !== scrollTop) onScroll(node.scrollTop)
    }
    if (entry === undefined) {
      pendingFocus.current = index
      onSearchRange?.(Math.floor((node.scrollTop * scale) / rowHeight))
      return
    }
    pendingFocus.current = null
    onSelect(entry!.path)
    requestAnimationFrame(() =>
      node
        .querySelector<HTMLElement>(`[data-browse-index="${index}"]`)
        ?.focus({ preventScroll: true })
    )
    // rowAt reads only what is listed here (the entries, the search rows and
    // the dividers' layout).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.indexedRows,
    props.entries,
    divided,
    onSelect,
    onScroll,
    onSearchRange,
    count,
    scale,
    scrollTop,
    height,
    rowHeight,
    contentH
  ])
  useLayoutEffect(() => {
    pendingFocus.current = null
    selectionPosition.current = { path: '', index: -1 }
  }, [props.directory, props.query, props.sort])
  /**
   * THE KEYBOARD'S PLACE APART FROM THE MARKS (#330). Ctrl+Up/Down/Home/End
   * move the focus and leave the selection alone, File Explorer's way, so a
   * Ctrl+Space can then mark a row that is not next to the others. Null while
   * the focus is on the selected row, which is almost always. Forgotten with
   * the folder, the search and the sort, and by any plain pick (a click, the
   * arrows), adjusted while rendering as React's pattern has it.
   */
  const [cursor, setCursor] = useState<string | null>(null)
  const cursorKey = `${props.directory}\u0000${props.query}\u0000${props.sort.key}${props.sort.direction}`
  const [cursorFor, setCursorFor] = useState(cursorKey)
  if (cursorFor !== cursorKey) {
    setCursorFor(cursorKey)
    setCursor(null)
  }
  /** A path's row in the list as drawn (dividers counted), or -1. */
  const indexOfPath = (path: string): number =>
    rowIndexOf(path, props.entries, props.indexedRows, divided)
  const { scrollToRow, scrollFollow, cursorIndex, cursorDropped } = useBrowseFollow({
    props,
    scrollerRef: scroller,
    handRef: hand,
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
  })
  const { onKeyDown } = useBrowseKeys({
    props,
    scrollerRef: scroller,
    count,
    layout,
    cols,
    rowHeight,
    height,
    scale,
    lead,
    logicalTop,
    rowAt,
    divided,
    selectedIndex,
    cursor,
    setCursor,
    cursorIndex,
    cursorDropped,
    indexOfPath,
    scrollToRow,
    pendingFocus,
    selectionPosition,
    typed,
    zoomTo
  })
  const pictures: EntryPictures = {
    on: thumbsOn,
    feed: thumbFeed,
    landing: props.landing,
    folderIcons
  }

  /** The header's buttons: a list's columns, or a grid's packed strip. */
  const headerColumns = headerColumnsFor({
    searching,
    bin: !!props.bin,
    archive: !!props.archive
  })
  const stripColumns = gridOn ? gridHeaderColumns(headerColumns, width) : headerColumns
  const view: EntryView = {
    props,
    folderDrop,
    firstPress,
    setCursor,
    scroller,
    cursor,
    cut,
    isMarked,
    look,
    pictures,
    count,
    searching,
    divided,
    groupOf
  }
  return (
    <div
      className="browse-list-area"
      data-grid={gridOn || undefined}
      data-searching={searching || undefined}
      data-in-archive={(!!props.archive && !searching) || undefined}
      data-in-bin={(!!props.bin && !searching) || undefined}
      data-row-size={sizeId}
      data-pending={props.pending && props.pending !== 'none' ? props.pending : undefined}
      data-slide-frozen={props.listSlideWidth !== undefined || undefined}
      style={
        {
          '--browse-row-h': `${look.height}px`,
          '--browse-row-font': `${look.font}px`,
          '--browse-row-icon': `${look.icon}px`,
          '--browse-row-thumb': `${look.thumb}px`,
          '--browse-row-gap': `${look.gap}px`,
          '--browse-row-pad': `${look.padX}px`,
          '--browse-tile-font': `${look.tileFont}px`,
          ...explorerHeadVars(sizeId)
        } as CSSProperties
      }
    >
      {/* The list's own layout box and size container (owner, 2026-11-08):
          the area paints the ground over its grid column, and while the
          preview slides this frame keeps the width the list ends at, so the
          columns are laid out once and stand still (workspace.css). */}
      <div
        className="browse-list-frame"
        inert={props.held || undefined}
        style={
          props.listSlideWidth !== undefined ? { width: `${props.listSlideWidth}px` } : undefined
        }
      >
        {props.strip && (
          <div className="browse-archive-strip-drop" {...folderDrop(props.directory, `strip`)}>
            {props.strip}
          </div>
        )}
        <BrowseColumnHeader
          columns={stripColumns}
          sort={props.sort}
          downloads={!!props.downloads}
          onSortChange={props.onSortChange}
          headerRef={columnScroller}
          listRef={scroller}
        />
        {/* A folder slower than 300 ms (#271): a thin bar under the header,
            never text over the list. Always in the layout, faded in, so the
            rows never move for it. */}
        <div
          className="browse-progress"
          aria-hidden="true"
          data-on={props.pending === 'slow' || undefined}
        />
        <div
          ref={scroller}
          className="browse-list"
          data-own-scrollbar
          role="listbox"
          aria-label={
            searching
              ? `Search results in ${props.directory} and subfolders`
              : `Files in ${props.directory}`
          }
          aria-busy={props.loading || !!props.searchState?.running}
          tabIndex={selectedIndex < firstItem || selectedIndex >= endItem ? 0 : -1}
          data-testid="browse-list"
          {...folderDrop(props.directory, 'list')}
          onKeyDown={onKeyDown}
          onPointerDown={onListPointerDown}
          onScroll={(e) => {
            if (
              columnScroller.current &&
              columnScroller.current.scrollLeft !== e.currentTarget.scrollLeft
            )
              columnScroller.current.scrollLeft = e.currentTarget.scrollLeft
            if (!props.loading) scrolledTo(e.currentTarget.scrollTop)
            scrollFollow(e.currentTarget)
          }}
          // Empty space clears the pick QUIETLY: it is not a request to stop what
          // the preview plays (owner, 2026-10-03: "i should have to click the
          // video or the pause icon"). A right press on an unmarked row too.
          onClick={(e) => {
            // The space beside the rows (#320) is the row layer's own box.
            const at = e.target as HTMLElement
            if (at === e.currentTarget || at.matches('.browse-row-space, .browse-row-layer'))
              props.onSelect(null, true)
          }}
          onContextMenu={(e) => {
            // The empty space's own menu: an archive's (#300), or a folder's
            // one row, Show as grid / list (Stage 6; a search keeps rows). A
            // row's menu stops here first.
            if (
              !props.onEmptyContextMenu ||
              (searching && !props.archive) ||
              (e.target as HTMLElement).closest('.browse-row, .browse-tile')
            )
              return
            e.preventDefault()
            props.onSelect(null, true)
            props.onEmptyContextMenu(e)
          }}
        >
          {props.message ? (
            <div className="browse-message" role="status">
              {props.message}
            </div>
          ) : (
            <div className="browse-row-space" style={{ height: spaceHeight }}>
              {layout && (
                <BrowseGrid
                  layout={layout}
                  firstRow={first}
                  firstItem={firstItem}
                  entries={rendered}
                  translateY={liveTop + first * rowHeight - logicalTop}
                  shiftByTop={props.renamingPath != null}
                  tile={(entry, index, rect) => entryTile(view, entry, index, rect)}
                />
              )}
              {!layout && (
                <div
                  className="browse-row-layer"
                  style={layerShift(
                    liveTop + first * rowHeight - logicalTop,
                    props.renamingPath != null
                  )}
                >
                  {entryRows(view, rendered, firstItem)}
                </div>
              )}
            </div>
          )}{' '}
          {sweep.sweeping && <SweepBand bandRef={sweep.bandRef} as="div" />}
        </div>
        <OverlayScrollbar target={scroller} />
      </div>
      {props.held && <BusyBar directory={props.directory} />}
    </div>
  )
}
