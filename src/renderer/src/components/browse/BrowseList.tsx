import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import type { ArchiveMeta } from '@shared/types'
import { browsableArchive, memberOf } from '@shared/archivePlace'
import { goesToWindows } from '../../lib/unsupported'
import { formatBytes, formatWhen } from '../../lib/format'
import { folderSizeCoverage, folderSizeLabel } from '../../lib/folderSize'
import { typeLabel } from '../../lib/typeLabel'
import { browseParent } from '../../lib/browse'
import { useFileCut } from '../../lib/fileClipboard'
import { DRAG_MIME, setDrag } from '../../lib/drag/dragDrop'
import { noteReady } from '../../lib/drag/dragOut'
import { SweepBand } from './SweepBand'
import { BusyBar } from './BusyBar'
import { FolderIcon, KindIcon, iconColour } from '../icons/FileIcons'
import { FolderGlyph } from '../icons/FolderGlyph'
import { folderIconOf, useFolderIcons } from '../../lib/folderIcons'
import { OverlayScrollbar } from './OverlayScrollbar'
import { explorerHeadVars } from '../../lib/explorerSize'
import {
  atStep,
  explorerZoom,
  headSizeOf,
  setExplorerZoom,
  useExplorerZoom,
  ZOOM_MAX_AVAILABLE,
  zoomIn,
  zoomOut
} from '../../lib/explorerZoom'
import { anchorAt, anchorScroll, type Anchor } from '../../lib/zoomAnchor'
import { createZoomWheel } from '../../lib/zoomWheel'
import { GRID_GAP, GRID_PAD, gridLayout, rowsWindow } from '../../lib/gridLayout'
import { gridHeaderColumns } from '../../lib/gridHeader'
import { binColumns, binnedOf, binnedPath } from '../../lib/binView'
import { bandBox, nearestRow, rowsInBox } from '../../lib/marquee'
import { cellSpan, cellsInBox, nearestCell } from '../../lib/cellsInBox'
import { useSweep } from '../../hooks/useSweep'
import { BrowseIcon } from '../icons/BrowseIcon'
import { useFolderDrop } from './useFolderDrop'
import type { BrowseEntry, BrowseSort, FolderBrowserProps } from './types'
import type { ListPending } from '../../hooks/usePendingHint'
import { divideRows, type DateDivider } from '../../lib/dateGroups'
import { nextSort } from '../../lib/downloadsView'
import { listKey, spaceKey, stepTo, type ListKey } from '../../lib/listKeys'
import { nearerEscape } from '../../lib/nearerEscape'
import { menuOrDialogUp } from '../../lib/pageDocuments'
import { hiddenTitle } from 'prism-term-core/renderer/lib/hiddenTitle'
import { createScrollSettle } from '../../lib/scrollSettle'
import { tierFor } from '@shared/thumbTypes'
import { thumbSource, visibleWants } from '../../lib/thumbKind'
import { useDocumentShown, useThumbFeed } from '../../lib/useThumbs'
import { ThumbImage } from './ThumbImage'
import { BrowseGrid } from './BrowseGrid'
import { GridTile } from './GridTile'
import { ProgressBar } from '../ProgressBar'
import { gridKey, gridStep, type GridKey } from '../../lib/gridNav'
import { FolderFill } from '../icons/Icon'

const OVERSCAN = 12
/** How long after the hand's last input (a wheel notch, a sweep's step) a
 *  scroll still counts as the hand's: a wheel's smooth scroll runs on after it. */
const HAND_MS = 800
/** A path's row in the list as drawn (dividers counted), or -1. */
function rowIndexOf(
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
/** The common keys the list answers itself (#330). */
const LIST_OWN: ReadonlySet<ListKey> = new Set<ListKey>([
  'select-all',
  'clear',
  'extend-up',
  'extend-down',
  'extend-home',
  'extend-end',
  'focus-up',
  'focus-down',
  'focus-home',
  'focus-end',
  'toggle-mark'
])
const columns: Array<{ key: BrowseSort['key']; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size' },
  { key: 'modified', label: 'Date modified' }
]
// Inside an archive (#300): Packed, right after Size, the container's own
// number for what each member occupies.
const archiveColumns: typeof columns = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size' },
  { key: 'packed', label: 'Packed' },
  { key: 'modified', label: 'Date modified' }
]
const searchColumns: typeof columns = [
  { key: 'name', label: 'Name' },
  { key: 'path', label: 'Path' },
  { key: 'size', label: 'Size' }
]

type Props = Pick<
  FolderBrowserProps,
  | 'directory'
  | 'selectedPath'
  | 'scrollTop'
  | 'sort'
  | 'onSelect'
  | 'onScroll'
  | 'onSortChange'
  | 'onContextMenu'
  | 'onRename'
  | 'onCopy'
  | 'query'
  | 'searchState'
  | 'onCancelSearch'
  | 'onSearchRange'
  | 'onDropInto'
  | 'onPreviewToggle'
  | 'covered'
  | 'listSlideWidth'
  | 'previewWindowOpen'
  | 'onPreviewWindowClose'
> & {
  /** This Explorer tab: the thumbnail asks are made and cancelled under it. */
  tabId?: string
  entries: BrowseEntry[]
  indexedRows?: Map<number, BrowseEntry | null>
  total: number
  onActivate: (entry: BrowseEntry) => void
  message: string | null
  loading: boolean
  /** A folder that has not answered (#271): 'quiet' dims the rows it keeps,
   *  'slow' runs the thin bar under the header. Never a loading message. */
  pending?: ListPending
  /** The pointer rests on a folder row (null: it left): read it ahead. */
  onFolderHover?: (path: string | null) => void
  onVisibleFolders?: (paths: string[]) => void
  /** Every marked row (the selection plus a sweep's or a Ctrl click's), or
   *  null when the one `selectedPath` is the whole selection. */
  marked?: ReadonlySet<string> | null
  /** Items a paste is still copying here, by lower-cased path, and how far
   *  each has got (0-100): drawn as inert rows with a bar (owner, 2026-10-28). */
  landing?: ReadonlyMap<string, number>
  /** A job over a second is changing this folder: the list is inert under the
   *  loading bar (owner, 2026-11-09, lib/holds). */
  held?: boolean
  /** A click that carries Ctrl or Shift: FolderBrowser builds the selection. */
  onPick?: (entry: BrowseEntry, mods: { ctrl: boolean; shift: boolean }) => void
  /** A sweep let go with the rectangle up: these rows, the keyboard on `near`.
   *  `add` is a Ctrl sweep, which keeps what was marked before it. */
  onSweep?: (paths: string[], near: string | null, add: boolean) => void
  /** Downloads' date groups (#285): a label row before each group's first
   *  entry. Never with `indexedRows` (a search is not grouped). */
  dividers?: readonly DateDivider[]
  /** This is Downloads: Date modified's first click sorts newest first. */
  downloads?: boolean
  /** The place on screen is inside an archive (#300): the Packed column, and
   *  a row dragged out carries archive members, not files on disk. */
  archive?: ArchiveMeta | null
  /** The place on screen is the Recycle Bin (D7): its columns, no drag out,
   *  no drops, no pictures. */
  bin?: boolean
  /** Drawn above the column header: the archive's strip. */
  strip?: ReactNode
  /** THE COMMON KEYS (#330), each quiet (#263): Shift+arrows mark the run
   *  from the anchor to `path`; Ctrl+Space puts `path` in or out of the marks;
   *  Ctrl+A marks every row; Ctrl+Shift+A and Escape clear, answering whether
   *  there was anything to clear (an Escape with nothing marked is not taken). */
  onExtend?: (path: string) => void
  onToggleMark?: (path: string) => void
  onSelectAll?: () => void
  onClear?: () => boolean
  /** Bring this row into view once per `seq` (#101: what an action just made
   *  is marked and scrolled to). Scroll only: the focus stays where it is. */
  revealPath?: { path: string; seq: number } | null
  /** A right press on the list's empty space (inside an archive, #300). */
  onEmptyContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void
}

export function BrowseList(props: Props): JSX.Element {
  const cut = useFileCut()
  // The bin takes no drop at all (D16): the handler is absent, so every
  // target says "no" explicitly (useFolderDrop).
  const folderDrop = useFolderDrop(props.loading || props.bin ? undefined : props.onDropInto, props.archive)
  /** What a press or drag on this row carries inside an archive: the row, or
   *  the whole selection when the row is in it, as members with their places. */
  const memberCargo = (
    path: string
  ): { archive: string; entries: string[]; places: string[] } | null => {
    const archive = props.archive
    if (!archive) return null
    const all = props.marked
    const paths = all && all.size > 1 && all.has(path) ? [...all] : [path]
    const entries: string[] = []
    const places: string[] = []
    for (const p of paths) {
      const inner = memberOf(archive, p)
      if (!inner) continue
      entries.push(inner)
      places.push(p)
    }
    return entries.length ? { archive: archive.container, entries, places } : null
  }
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
  const liveTop = live.top
  useLayoutEffect(() => {
    if (scroller.current && !props.loading) scroller.current.scrollTop = live.top
    // Only when a position is TAKEN from the tab (or the load ends), never
    // per scroll: the list is already where it scrolled to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.taken, props.loading])

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
  const thumbsOn = pictureEdge > 0 && !searching && !props.archive && !props.bin && !props.indexedRows
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
  /** The hand's last scrolling input, and a scroll it is holding (the
   *  scrollbar's thumb, a finger, the middle button's autoscroll). */
  const hand = useRef<{ at: number; hold: 'bar' | 'touch' | 'auto' | null }>({
    at: -Infinity,
    hold: null
  })
  const sweep = useSweep({
    scroller: () => scroller.current,
    // Read at the press and after a scroll only (#332): never per move.
    measure: () => {
      const node = scroller.current
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
      if (geometry.current.layout) return { left: 0, right: scroller.current?.scrollWidth ?? 0 }
      // What is drawn as a row across (#326): the list's left to the end of
      // its last column, a gutter short of the edge (#320), measured off any
      // row in view, since every row is the one grid. A row out of view is
      // the same width, so it is still hit by its index.
      const node = scroller.current
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
      const across = drawnAcross ?? { left: 0, right: scroller.current?.scrollWidth ?? 0 }
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
      const node = scroller.current
      if (!node) return
      // The sweep's autoscroll is the hand's: the pointer at the edge asks it.
      hand.current.at = performance.now()
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
    if ((e.target as HTMLElement).closest('.browse-row[data-browse-path], .browse-tile[data-browse-path]'))
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
      const node = scroller.current
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
    const node = scroller.current
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
      node.scrollTop = target / scale
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
      node.scrollTop =
        anchorScroll({
          ...a,
          pointerY: 0,
          cellH: rowHeight,
          count,
          viewH: node.clientHeight,
          cols,
          lead
        }) / scale
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
    const node = scroller.current
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
  }, [])
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
      node.scrollTop = Math.max(0, (contentH - height) / scale)
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
  /** Bring a row into view, stepping off a divider the way `toward` points;
   *  the row's entry, or null when it is not there to land on. */
  /** Scroll so the row at `index` is in view (its divider too, at a group's
   *  top), and hand the position up. */
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
    if (top < visibleTop) node.scrollTop = top / scale
    else if (bottom > visibleTop + node.clientHeight)
      node.scrollTop = (bottom - node.clientHeight) / scale
    handUp(node.scrollTop)
  }
  const reveal = (index: number, toward: 1 | -1): { index: number; entry: BrowseEntry } | null => {
    const node = scroller.current
    if (!node) return null
    while (index >= 0 && index < count && rowAt(index) === null) index += toward
    if (index < 0 || index >= count) return null
    scrollToRow(node, index)
    const entry = rowAt(index)
    if (!entry) return null
    requestAnimationFrame(() =>
      node
        .querySelector<HTMLElement>(`[data-browse-index="${index}"]`)
        ?.focus({ preventScroll: true })
    )
    return { index, entry }
  }
  // WHAT AN ACTION MADE COMES INTO VIEW (#101), once per request.
  const revealedSeq = useRef(0)
  useLayoutEffect(() => {
    const want = props.revealPath
    const node = scroller.current
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
   * of those inputs holds it or for HAND_MS after the last of them. Scrolling
   * back to the selection by hand follows again.
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
    return cellTop(index) >= visibleTop - 1 && cellBottom(index) <= visibleTop + node.clientHeight + 1
  }
  const detached = useRef(false)
  const followed = useRef<string | null>(null)
  const followNow = useRef({ index: followIndex, inView: cellInView })
  useLayoutEffect(() => {
    followNow.current = { index: followIndex, inView: cellInView }
  })
  /** A scroll event: the hand's, it decides whether the list still follows. */
  const scrollFollow = (node: HTMLDivElement): void => {
    const h = hand.current
    if (!h.hold && performance.now() - h.at > HAND_MS) return
    const { index, inView } = followNow.current
    detached.current = index >= 0 && !inView(node, index)
  }
  useLayoutEffect(() => {
    const node = scroller.current
    const area = node?.closest<HTMLElement>('.browse-list-area')
    if (!node || !area) return
    const now = (): number => performance.now()
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) hand.current = { at: now(), hold: null }
    }
    const onDown = (e: PointerEvent): void => {
      const h = hand.current
      // A press ends the middle button's autoscroll (Chromium's own), and
      // that press is the hand's too.
      if (h.hold === 'auto') hand.current = { at: now(), hold: null }
      const at = e.target as HTMLElement
      if (at.closest('.browse-overlay-scroll')) hand.current = { at: now(), hold: 'bar' }
      else if (!node.contains(at)) return
      else if (e.pointerType === 'touch') hand.current = { at: now(), hold: 'touch' }
      else if (e.button === 1) hand.current = { at: now(), hold: 'auto' }
    }
    const onUp = (): void => {
      const h = hand.current
      // A finger's fling runs on after it lifts.
      if (h.hold === 'bar') hand.current = { at: now(), hold: null }
      else if (h.hold === 'touch') hand.current = { at: now() + 1200, hold: null }
    }
    const onKey = (): void => {
      if (hand.current.hold === 'auto') hand.current = { at: now(), hold: null }
    }
    const onDragOver = (): void => {
      hand.current = { ...hand.current, at: now() }
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
  }, [])
  // After the tab's own scroll is put back (the effect at the top) and after
  // a zoom's anchor: neither is fought while the selection is in view anyway.
  useLayoutEffect(() => {
    if (followPath !== followed.current) {
      // A new selection: the list follows again, whatever the hand did.
      followed.current = followPath
      detached.current = false
      hand.current = { at: -Infinity, hold: hand.current.hold }
    }
    const node = scroller.current
    if (!node || props.loading || props.message || detached.current || followIndex < 0) return
    if (followIndex >= count) return
    if (!cellInView(node, followIndex)) scrollToRow(node, followIndex)
    // cellInView and scrollToRow read this render's geometry, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
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
  const focusRow = (index: number): void => {
    const node = scroller.current
    if (!node) return
    setCursor(null)
    const direction = index === 0 ? 1 : index < selectedIndex || index === count - 1 ? -1 : 1
    while (index >= 0 && index < count && rowAt(index) === null) index += direction
    if (index < 0 || index >= count) return
    // A group's first row going up brings its divider into view with it.
    scrollToRow(node, index)
    const entry = rowAt(index)
    if (entry) {
      pendingFocus.current = null
      props.onSelect(entry.path)
      requestAnimationFrame(() =>
        node
          .querySelector<HTMLElement>(`[data-browse-index="${index}"]`)
          ?.focus({ preventScroll: true })
      )
    } else {
      pendingFocus.current = index
      node.focus({ preventScroll: true })
      props.onSearchRange?.(Math.floor((node.scrollTop * scale) / rowHeight))
    }
  }
  /** The common keys that act on the list's own rows (#330); the rest of them
   *  (new folder, the bin, F3, Properties...) are FolderBrowser's. True when
   *  the key was taken. */
  const listOwnKey = (k: ListKey): boolean => {
    if (k === 'clear') return !!props.onClear?.()
    if (k === 'select-all') {
      if (!count || !props.onSelectAll) return false
      setCursor(null)
      props.onSelectAll()
      return true
    }
    // From the keyboard's place: the cursor while it is apart, else the row
    // the selection is on (or was on, when it has scrolled away).
    const here = cursor !== null ? indexOfPath(cursor) : -1
    const from = here >= 0 ? here : selectedIndex >= 0 ? selectedIndex : -1
    if (k === 'toggle-mark') {
      const path = here >= 0 ? cursor : props.selectedPath
      if (!path || !props.onToggleMark) return false
      props.onToggleMark(path)
      // The focus stays on the row whether it went in or out.
      setCursor(path)
      return true
    }
    const move = /^(extend|focus)-(up|down|home|end)$/.exec(k)
    if (!move) return false
    const to = stepTo(count, from, move[2] as 'up' | 'down' | 'home' | 'end')
    if (to === null) return true
    const toward: 1 | -1 = move[2] === 'up' || move[2] === 'end' ? -1 : 1
    const landed = reveal(to, toward)
    if (!landed) return true
    if (move[1] === 'focus') {
      setCursor(landed.entry.path)
      return true
    }
    // Shift: the marks run from the anchor to here, and here is the place.
    setCursor(null)
    props.onExtend?.(landed.entry.path)
    return true
  }
  /**
   * THE GRID'S ARROWS (Stage 5, spec 5.2): the keyboard's place moves in two
   * dimensions through `gridStep`, and the three modes are the list's own
   * (a pick, Shift's range from the anchor, Ctrl's focus without marks), so
   * the marks, the cursor and the reveal are the code the rows use.
   */
  const gridMove = (g: GridKey): void => {
    const here = cursor !== null ? indexOfPath(cursor) : -1
    const remembered =
      selectedIndex >= 0
        ? selectedIndex
        : selectionPosition.current.path === props.selectedPath
          ? selectionPosition.current.index
          : -1
    const pending = pendingFocus.current
    const from = pending !== null && Number.isFinite(pending) ? pending : here >= 0 ? here : remembered
    const to = gridStep(count, cols, from, g.to, Math.floor(height / rowHeight))
    if (to === null) return
    if (g.mode === 'move') {
      focusRow(to)
      return
    }
    const landed = reveal(to, g.to === 'up' || g.to === 'left' || g.to === 'end' ? -1 : 1)
    if (!landed) return
    if (g.mode === 'focus') {
      setCursor(landed.entry.path)
      return
    }
    // Shift: the marks run over the index range from the anchor to here.
    setCursor(null)
    props.onExtend?.(landed.entry.path)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Ctrl+Plus, Ctrl+Minus and Ctrl+0 are the wheel's keys (nothing else in
    // the Explorer binds them; the app menu is gone). Only while the list or
    // one of its rows has the keyboard, never a field inside it.
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const change =
        e.key === '+' || e.key === '='
          ? 1
          : e.key === '-' || e.key === '_'
            ? -1
            : e.key === '0'
              ? 0
              : null
      const at = e.target as HTMLElement
      if (
        change !== null &&
        (at === e.currentTarget ||
          (at.matches('.browse-row, .browse-tile') && !at.isContentEditable))
      ) {
        e.preventDefault()
        e.stopPropagation()
        const step = explorerZoom()
        zoomTo.current(change === 0 ? 1 : change > 0 ? zoomIn(step) : zoomOut(step), null)
        return
      }
    }
    // THE GRID'S ARROWS come before the common keys: Left and Right are the
    // grid's alone (the list leaves them to the viewer), and the rest of the
    // arrows, Home, End and the Page keys move by line there. Never from a
    // field inside the list (the rename box).
    if (layout && count) {
      const g = gridKey(e, true)
      const at = e.target as HTMLElement
      if (g && !at.isContentEditable && !/^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName)) {
        e.preventDefault()
        e.stopPropagation()
        gridMove(g)
        return
      }
    }
    const common = listKey(e)
    if (common) {
      // Escape is a nearer closer's first (a peek, the PDF's find bar, a
      // menu): those listen on the window, after this (review of #330).
      if (common === 'clear' && e.key === 'Escape' && nearerEscape()) return
      // The preview window first (owner, 2026-11-08): Escape closes it and
      // leaves the marks; the next Escape clears them as before.
      if (common === 'clear' && e.key === 'Escape' && props.previewWindowOpen && !e.repeat) {
        const front = props.covered || menuOrDialogUp()
        if (!front) {
          e.preventDefault()
          e.stopPropagation()
          props.onPreviewWindowClose?.()
          return
        }
      }
      if (LIST_OWN.has(common) && listOwnKey(common)) {
        // Claimed: the player's window-wide keys (Ctrl+Space is play, Shift+
        // Home a seek) yield to a key the list took.
        e.preventDefault()
        e.stopPropagation()
      }
      return
    }
    // SPACE TOGGLES THE PREVIEW PANE (owner, 2026-11-08: "can you bind
    // preview to space bar", then "Toggle the preview panel"): the toolbar
    // button's own toggle, with or without a row picked, but only while the
    // list or one of its rows has the keyboard (never a field inside it).
    // A space inside a type-to-jump run is part of the name instead.
    const space = spaceKey(e, typed.current, performance.now())
    if (space) {
      const at = e.target as HTMLElement
      const own =
        at === e.currentTarget || (at.matches('.browse-row, .browse-tile') && !at.isContentEditable)
      if (!own) return
      e.preventDefault()
      e.stopPropagation()
      // Something in front of the list (a menu opened with the mouse leaves
      // the focus on its row, a question, Settings): the key is taken but
      // nothing behind it changes.
      const front = props.covered || menuOrDialogUp()
      if (space === 'preview' && !front) props.onPreviewToggle?.()
      if (space !== 'type') return
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return
    if (!count) {
      if (
        props.searchState?.running &&
        ['Home', 'End', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(e.key)
      ) {
        e.preventDefault()
        e.stopPropagation()
        pendingFocus.current = e.key === 'End' ? Infinity : 0
      }
      return
    }
    const page = Math.max(1, Math.floor(height / rowHeight) - 1) * cols
    const rememberedIndex =
      selectedIndex >= 0
        ? selectedIndex
        : selectionPosition.current.path === props.selectedPath
          ? selectionPosition.current.index
          : -1
    // The plain arrows carry on from a cursor the Ctrl keys moved (#330).
    const currentIndex =
      pendingFocus.current ??
      (cursorIndex >= 0
        ? cursorIndex
        : rememberedIndex < 0
          ? Math.max(0, Math.floor((logicalTop - lead) / rowHeight)) * cols - 1
          : rememberedIndex)
    let next: number
    if (e.key === 'ArrowDown') next = Math.min(count - 1, currentIndex + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, currentIndex - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    else if (e.key === 'PageDown') next = Math.min(count - 1, Math.max(0, currentIndex) + page)
    else if (e.key === 'PageUp') next = Math.max(0, currentIndex - page)
    else if (e.key === 'Enter' && props.selectedPath) {
      e.preventDefault()
      e.stopPropagation()
      const entry =
        rowAt(selectedIndex) ?? props.entries.find((entry) => entry.path === props.selectedPath)
      // A HELD ENTER IS ONE OPEN (#494; review, 2026-11-09): the key repeating
      // handed the program to Windows thirty times a second, and an Enter
      // held from a question or the search box repeated onto this row.
      // `openGuards` e2e.
      if (entry && !(e.repeat && entry.file && goesToWindows(entry.file))) props.onActivate(entry)
      return
    } else if (e.key.length === 1 && !e.shiftKey) {
      const now = performance.now()
      typed.current = {
        text:
          now - typed.current.at < 700
            ? typed.current.text + e.key.toLowerCase()
            : e.key.toLowerCase(),
        at: now
      }
      const match = props.entries.findIndex((entry) =>
        entry.name.toLowerCase().startsWith(typed.current.text)
      )
      if (match < 0) return
      const matched = props.entries[match]
      next = props.indexedRows
        ? ([...props.indexedRows].find(([, entry]) => entry?.path === matched.path)?.[0] ?? -1)
        : divided
          ? divided.rowOf(match)
          : match
      if (next < 0) return
    } else return
    e.preventDefault()
    e.stopPropagation()
    focusRow(next)
  }

  /**
   * WHAT A PRESS, A DRAG, A DROP, A DOUBLE CLICK AND A RIGHT-CLICK ON AN ENTRY
   * DO: one set for a row and a tile alike (Stage 4 pulled it out of the row,
   * unchanged), so the two can never disagree.
   */
  const entryHandlers = (entry: BrowseEntry, selected: boolean) => ({
    // Nothing is dragged out of the bin (D16): a bin path is not a place to
    // copy from, and a drop elsewhere would move `$R` and leave `$I`.
    draggable: !props.bin,
    // A FOLDER takes a drop into itself; an ARCHIVE row too
    // (#70 D6): a .zip adds what is dropped on it, a 7z or a
    // rar shows no-drop (Prism cannot write them). Any other
    // file row means the folder it is in.
    ...folderDrop(
      entry.isFolder || browsableArchive(entry.name)
        ? entry.path
        : (browseParent(entry.path) ?? props.directory),
      entry.path
    ),
    onMouseDown: (event: ReactMouseEvent) => {
      // THE PRESS ON A MEMBER EXTRACTS IT (#103, D5): a drag
      // out of the window needs real files before it starts,
      // so main unpacks the cargo now (64 MB and 64 members at
      // most), while the pointer travels to the edge.
      if (event.button !== 0 || !props.archive) return
      const cargo = memberCargo(entry.path)
      if (!cargo) return
      // Its answer is what lets the edge hand off (`isReady`).
      const req = { kind: 'members' as const, ...cargo }
      void window.prism
        .dragPrepare(req)
        .then((r) => noteReady(req, r.ok))
        .catch(() => noteReady(req, false))
    },
    onDragStart: (event: ReactDragEvent) => {
      // A row inside a multi-selection carries all of it,
      // the tree's rule.
      const all = props.marked
      const paths = all && all.size > 1 && all.has(entry.path) ? [...all] : [entry.path]
      // Rows inside an archive are its MEMBERS (#300): dropped on
      // a real folder they extract there, the archive view's own
      // drag; dropped inside the same zip they move.
      const cargo = memberCargo(entry.path)
      if (cargo) {
        setDrag({ kind: 'members', ...cargo })
        event.dataTransfer.effectAllowed = 'copyMove'
        event.dataTransfer.setData(DRAG_MIME, 'members')
        return
      }
      setDrag({ kind: 'files', paths })
      event.dataTransfer.effectAllowed = 'copyMove'
      event.dataTransfer.setData(DRAG_MIME, 'files')
    },
    onDragEnd: () => setDrag(null),
    onClick: (e: ReactMouseEvent) => {
      if (e.detail === 1) firstPress.current = entry.path
      setCursor(null)
      if ((e.ctrlKey || e.shiftKey) && props.onPick)
        props.onPick(entry, { ctrl: e.ctrlKey, shift: e.shiftKey })
      else props.onSelect(entry.path)
    },
    // WHAT WAS PRESSED IS WHAT OPENS (#494; review, 2026-11-09). A new
    // file slides the rows between the two presses, and Chromium
    // counts a double-click by place and time, so the second one
    // lands on whatever is there now. A row that leaves for Windows
    // can start a program: only the row first pressed. `openGuards` e2e.
    onDoubleClick: () => {
      if (entry.file && goesToWindows(entry.file) && firstPress.current !== entry.path) return
      props.onActivate(entry)
    },
    onPointerEnter:
      entry.isFolder && props.onFolderHover ? () => props.onFolderHover?.(entry.path) : undefined,
    onPointerLeave:
      entry.isFolder && props.onFolderHover ? () => props.onFolderHover?.(null) : undefined,
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      if (props.onContextMenu) {
        e.preventDefault()
        // A RIGHT-CLICK SELECTS, as File Explorer's does
        // (#296; owner, 2026-10-06: "i see file explorer
        // uses the same highlight if you select a file with
        // left or rightclick. we should probably do the
        // same"). An unmarked row becomes THE selection, in
        // the one look a selection has; inside several marked
        // rows the marks stay and the menu acts on them all.
        // Quiet, as a Ctrl click is (#263): it marks, it does
        // not preview, play or open anything.
        if (!selected) props.onSelect(entry.path, true)
        props.onContextMenu(e, entry)
      }
    }
  })

  /** A tile's picture box: the photo or film's thumbnail when it has one, else
   *  the kind icon (or the folder's) centred on the same quiet ground. The box
   *  is the same size before and after a picture arrives (spec 4.6). */
  const tileMedia = (entry: BrowseEntry, selected: boolean): JSX.Element => {
    const edge = look.edge
    const iconSize = Math.min(64, Math.round(edge * 0.4))
    const src =
      thumbsOn && !props.landing?.has(entry.path.toLowerCase()) ? thumbSource(entry) : null
    const kind = (size: number): JSX.Element => (
      <KindIcon
        kind={entry.file!.kind}
        ext={entry.file!.ext}
        name={entry.name}
        color={iconColour(entry.file!.kind)}
        size={size}
        bg={selected ? 'var(--sel-seen, var(--p-sel-tint-seen))' : 'var(--p-bg)'}
      />
    )
    if (entry.file && src)
      return (
        <ThumbImage
          feed={thumbFeed}
          path={entry.path}
          source={src}
          film={entry.file.kind === 'video'}
          box={edge}
          icon={kind(iconSize)}
        />
      )
    let icon: JSX.Element
    if (entry.isFolder) {
      const own = folderIconOf(folderIcons, entry.path)
      const folder = <FolderFill size={iconSize} color="var(--p-tree-folder)" />
      icon = own ? (
        <FolderGlyph icon={own} size={iconSize} color="var(--p-tree-folder)" fallback={folder} />
      ) : (
        folder
      )
    } else icon = entry.file ? kind(iconSize) : <span />
    return (
      <span className="browse-thumb" style={{ width: edge, height: edge }} data-thumb-state="icon">
        <span className="browse-thumb-icon">{icon}</span>
      </span>
    )
  }

  /** The header's buttons: a list's columns, or a grid's packed strip. */
  const headerColumns = searching
    ? searchColumns
    : props.bin
      ? binColumns
      : props.archive
        ? archiveColumns
        : columns
  const stripColumns = gridOn ? gridHeaderColumns(headerColumns, width) : headerColumns

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
        <div
          className="browse-column-viewport"
          ref={columnScroller}
          onScroll={(event) => {
            const head = event.currentTarget
            if (scroller.current && scroller.current.scrollLeft !== head.scrollLeft) {
              scroller.current.scrollLeft = head.scrollLeft
              // A list with nothing to scroll cannot follow: the header goes
              // back to it, or a focused last header cell (its box runs on to
              // the edge) leaves the labels shifted off their columns. Seen
              // in the bin, where Type is the last cell.
              if (scroller.current.scrollLeft !== head.scrollLeft) head.scrollLeft = scroller.current.scrollLeft
            }
          }}
        >
          <div className="browse-columns">
            {stripColumns.map(({ key, label }) => (
              <button
                key={key}
                className={`browse-column-${key}`}
                title={`Sort by ${label.toLowerCase()}`}
                aria-label={`Sort by ${label.toLowerCase()}${props.sort.key === key ? `, ${props.sort.direction === 'asc' ? 'ascending' : 'descending'}` : ''}`}
                onClick={() => props.onSortChange(nextSort(props.sort, key, !!props.downloads))}
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
                  data-sorted={props.sort.key === key || undefined}
                  data-descending={
                    props.sort.key === key
                      ? props.sort.direction === 'desc'
                      : nextSort(props.sort, key, !!props.downloads).direction === 'desc'
                  }
                >
                  <BrowseIcon name="up" />
                </span>
              </button>
            ))}
          </div>
        </div>
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
                  tile={(entry, index, rect) => {
                    const key = entry.path.toLowerCase()
                    const selected = isMarked(entry.path)
                    return (
                      <GridTile
                        key={entry.path}
                        name={entry.name}
                        path={entry.path}
                        index={index}
                        rect={rect}
                        media={tileMedia(entry, selected)}
                        selected={selected}
                        primary={entry.path === props.selectedPath}
                        cursor={cursor === entry.path}
                        cut={cut.has(key)}
                        landing={props.landing?.has(key) ? (props.landing.get(key) ?? 0) : undefined}
                        posInSet={index + 1}
                        setSize={count}
                        handlers={entryHandlers(entry, selected)}
                      />
                    )
                  }}
                />
              )}
              {!layout && (
                <div
                  className="browse-row-layer"
                  style={{
                    transform: `translateY(${liveTop + first * rowHeight - logicalTop}px)`
                  }}
                >
                  {rendered.map((entry, offset) => {
                    const divider = divided?.divider(firstItem + offset)
                    if (divider)
                      // A label, not a row: nothing to pick, focus, drag or drop
                      // on, and hidden from the listbox, whose options are files.
                      return (
                        <div
                          key={`group-${divider.group}`}
                          className="browse-divider"
                          aria-hidden="true"
                          data-date-group={divider.group}
                        >
                          <span>{divider.label}</span>
                        </div>
                      )
                    if (!entry)
                      return (
                        <div
                          key={`pending-${firstItem + offset}`}
                          className="browse-row"
                          aria-hidden="true"
                        >
                          <span className="browse-column-name browse-name">
                            {/* A search row still on its way is a blank row (#271):
                              no loading text anywhere in the list. */}
                            {entry === null ? 'Item unavailable' : ''}
                          </span>
                        </div>
                      )
                    const primary = entry.path === props.selectedPath
                    const selected = isMarked(entry.path)
                    // A marked run is one block: its edge is drawn round the
                    // run, never between two marked neighbours (browse.css).
                    const above = rendered[offset - 1]
                    const below = rendered[offset + 1]
                    const joinUp = selected && !!above && isMarked(above.path)
                    const joinDown = selected && !!below && isMarked(below.path)
                    return (
                      <button
                        key={entry.path}
                        role="option"
                        aria-selected={selected}
                        aria-posinset={
                          (divided
                            ? (divided.entryAt(firstItem + offset) ?? 0)
                            : firstItem + offset) + 1
                        }
                        aria-setsize={divided ? props.entries.length : count}
                        tabIndex={primary ? 0 : -1}
                        className="browse-row"
                        data-cut={cut.has(entry.path.toLowerCase()) || undefined}
                        data-landing={props.landing?.has(entry.path.toLowerCase()) || undefined}
                        aria-busy={props.landing?.has(entry.path.toLowerCase()) || undefined}
                        // Still copying: nothing to open, preview or drag yet.
                        inert={props.landing?.has(entry.path.toLowerCase()) || undefined}
                        aria-description={
                          [
                            groupOf?.[divided?.entryAt(firstItem + offset) ?? -1],
                            cut.has(entry.path.toLowerCase()) ? 'Cut' : ''
                          ]
                            .filter(Boolean)
                            .join(', ') || undefined
                        }
                        data-browse-path={entry.path}
                        data-browse-index={firstItem + offset}
                        data-selected={selected || undefined}
                        data-cursor={(cursor === entry.path && !primary) || undefined}
                        data-join-up={joinUp || undefined}
                        data-join-down={joinDown || undefined}
                        title={searching ? entry.path : undefined}
                        {...entryHandlers(entry, selected)}
                      >
                        <span className="browse-column-name browse-name">
                          {entry.isFolder
                            ? (() => {
                                const own = folderIconOf(folderIcons, entry.path)
                                // At the picture steps (3, 4) a folder is as big as a file's
                                // icon (owner, 2026-11-10); steps 0 to 2 keep the row icon.
                                const folder = (
                                  <FolderIcon color="var(--p-tree-folder)" size={look.thumb ? look.icon : undefined} />
                                )
                                // A picked glyph wears the folder colour (D4).
                                const glyph = own ? (
                                  <FolderGlyph
                                    icon={own}
                                    size={look.icon}
                                    color="var(--p-tree-folder)"
                                    fallback={folder}
                                  />
                                ) : (
                                  folder
                                )
                                return look.thumb ? (
                                  <span className="browse-thumb-slot">{glyph}</span>
                                ) : (
                                  glyph
                                )
                              })()
                            : entry.file &&
                              (() => {
                                // Steps 3 and 4: a photo or a film gets a picture box (its icon
                                // half the box until the picture arrives); every other row keeps
                                // its icon centred in a slot of the same width, so names line up.
                                const src =
                                  thumbsOn && !props.landing?.has(entry.path.toLowerCase())
                                    ? thumbSource(entry)
                                    : null
                                // A marked row is a tint, so its icon keeps its own
                                // colours; its knockouts are the tint as seen
                                // (dimmed or not: browse.css sets --sel-seen).
                                const kind = (size: number): JSX.Element => (
                                  <KindIcon
                                    kind={entry.file!.kind}
                                    ext={entry.file!.ext}
                                    name={entry.name}
                                    color={iconColour(entry.file!.kind)}
                                    size={size}
                                    bg={
                                      selected
                                        ? 'var(--sel-seen, var(--p-sel-tint-seen))'
                                        : 'var(--p-bg)'
                                    }
                                  />
                                )
                                if (src)
                                  return (
                                    <ThumbImage
                                      feed={thumbFeed}
                                      path={entry.path}
                                      source={src}
                                      film={entry.file.kind === 'video'}
                                      box={look.thumb}
                                      icon={kind(Math.min(64, Math.round(look.thumb * 0.5)))}
                                    />
                                  )
                                return look.thumb ? (
                                  <span className="browse-thumb-slot">{kind(look.icon)}</span>
                                ) : (
                                  kind(look.icon)
                                )
                              })()}
                          <span className="browse-name-text">
                            <span {...(searching ? {} : hiddenTitle(entry.name))}>
                              {entry.name}
                            </span>
                          </span>
                        </span>
                        {/* THE BIN'S TWO COLUMNS (D7): where it was and when it was
                            deleted, right after the name. The full original path
                            is the cell's title. */}
                        {props.bin && !searching && (
                          <>
                            <span
                              className="browse-column-from"
                              title={binnedOf(entry) ? binnedPath(binnedOf(entry)!.from, entry.name) : undefined}
                            >
                              {binnedOf(entry)?.from ?? ''}
                            </span>
                            <span className="browse-column-deleted">
                              {binnedOf(entry) ? formatWhen(binnedOf(entry)!.at) : ''}
                            </span>
                          </>
                        )}
                        {!(props.bin && !searching) && (
                          <span
                            className={
                              searching
                                ? 'browse-column-path browse-result-location'
                                : 'browse-column-type'
                            }
                          >
                            {searching
                              ? (browseParent(entry.path) ?? entry.path)
                              : props.landing?.has(entry.path.toLowerCase())
                                ? 'Copying…'
                                : typeLabel(entry.name, entry.isFolder)}
                          </span>
                        )}
                        <span
                          className="browse-column-size"
                          title={
                            entry.folderSize ? folderSizeCoverage(entry.folderSize) : undefined
                          }
                        >
                          {/* No size yet is a blank cell, never "0 B" (#271). */}
                          {props.landing?.has(entry.path.toLowerCase()) ? (
                            <ProgressBar
                              size="thin"
                              className="browse-landing"
                              pct={props.landing.get(entry.path.toLowerCase()) ?? 0}
                              label="Copying"
                            />
                          ) : entry.file ? (
                            entry.file.size === undefined ? (
                              ''
                            ) : (
                              formatBytes(entry.file.size)
                            )
                          ) : (
                            folderSizeLabel(entry.folderSize)
                          )}
                        </span>
                        {!!props.archive && !searching && (
                          <span className="browse-column-packed">
                            {entry.file?.packed !== undefined ? formatBytes(entry.file.packed) : ''}
                          </span>
                        )}
                        {props.bin && !searching && (
                          <span className="browse-column-type">{typeLabel(entry.name, entry.isFolder)}</span>
                        )}
                        {!searching && !props.bin && (
                          <span className="browse-column-modified">
                            {/* A folder's date too, now it has one (#285). */}
                            {formatWhen(entry.file ? entry.file.mtimeMs : entry.mtimeMs)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {sweep.sweeping && <SweepBand bandRef={sweep.bandRef} as="div" />}
        </div>
        <OverlayScrollbar target={scroller} />
      </div>
      {props.held && <BusyBar directory={props.directory} />}
    </div>
  )
}
