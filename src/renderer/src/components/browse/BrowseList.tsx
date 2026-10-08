import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import type { ArchiveMeta } from '@shared/types'
import { memberOf } from '@shared/archivePlace'
import { formatBytes, formatWhen } from '../../lib/format'
import { folderSizeCoverage, folderSizeLabel } from '../../lib/folderSize'
import { typeLabel } from '../../lib/typeLabel'
import { browseParent } from '../../lib/browse'
import { useFileCut } from '../../lib/fileClipboard'
import { DRAG_MIME, setDrag } from '../../lib/dragDrop'
import { FolderIcon, KindIcon, SweepBand, iconColour } from '../TreeRows'
import { OverlayScrollbar } from './OverlayScrollbar'
import { explorerHeadVars, explorerRow, useExplorerSize } from '../../lib/explorerSize'
import { contentToClient, nearestRow, rowsInBox } from '../../lib/marquee'
import { useSweep, type SweepRow } from '../../hooks/useSweep'
import { BrowseIcon } from './BrowseIcon'
import { useFolderDrop } from './useFolderDrop'
import type { BrowseEntry, BrowseSort, FolderBrowserProps } from './types'
import type { ListPending } from '../../lib/usePendingHint'
import { divideRows, type DateDivider } from '../../lib/dateGroups'
import { nextSort } from '../../lib/downloadsView'
import { listKey, stepTo, type ListKey } from '../../lib/listKeys'
import { nearerEscape } from '../../lib/nearerEscape'

const OVERSCAN = 12
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
> & {
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
  /** A right press on the list's empty space (inside an archive, #300). */
  onEmptyContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void
}

export function BrowseList(props: Props): JSX.Element {
  const cut = useFileCut()
  const folderDrop = useFolderDrop(props.loading ? undefined : props.onDropInto)
  const searching = !!props.query.trim()
  // The row is Settings > Style > Explorer size: Medium is the tree's own row
  // (#257), Large the Explorer's old one, Small a step under Medium.
  const sizeId = useExplorerSize()
  const look = explorerRow(sizeId)
  const rowHeight = look.height
  const scroller = useRef<HTMLDivElement>(null)
  const columnScroller = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(600)
  const typed = useRef({ text: '', at: 0 })
  const pendingFocus = useRef<number | null>(null)
  const selectionPosition = useRef({ path: '', index: -1 })
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  /**
   * THE SCROLL IS THE LIST'S OWN WHILE IT MOVES (#332; owner, 2026-10-08: the
   * sweep box shakes). Every scroll event patched App's tab state, which
   * re-rendered App, and an effect then wrote that value back to the box: a
   * value already a step old, so it undid the newer scroll. While the sweep
   * auto-scrolled the list advanced every other frame, and a smooth wheel
   * scroll was cut short. Now the rows are drawn from `top`, the box's own
   * position, and App hears it when the scroll comes to rest (`scrollend`), at
   * the release of a sweep, and before any press or key that could take the
   * list somewhere else (so the tab and the history keep the right place).
   * A value from App is written to the box only when it is App's own: another
   * folder, a load that ended, a sort that went back to the top, another tab.
   */
  const [top, setTop] = useState(props.scrollTop)
  /** The last place App was told of, or was the one to set. */
  const told = useRef(props.scrollTop)
  /** A place App has not been told of yet. */
  const untold = useRef<number | null>(null)
  const onScrollRef = useRef(props.onScroll)
  useLayoutEffect(() => {
    onScrollRef.current = props.onScroll
  })
  const tell = (value: number): void => {
    untold.current = null
    told.current = value
    onScrollRef.current(value)
  }
  /** A scroll the list made itself (a key, a reveal): drawn and told at once. */
  const scrolledTo = (value: number): void => {
    setTop(value)
    tell(value)
  }
  const flushScroll = (): void => {
    if (untold.current !== null) tell(untold.current)
  }
  const flushRef = useRef(flushScroll)
  useLayoutEffect(() => {
    flushRef.current = flushScroll
  })
  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    const rest = (): void => {
      // A sweep's own auto-scroll is told once, at its release.
      if (!node.hasAttribute('data-sweeping')) flushRef.current()
    }
    // Anything that can navigate (a click, a key, a back button) comes after
    // a press or a key: the place is told first, to the folder it belongs to.
    const before = (): void => flushRef.current()
    node.addEventListener('scrollend', rest)
    window.addEventListener('pointerdown', before, true)
    window.addEventListener('keydown', before, true)
    return () => {
      node.removeEventListener('scrollend', rest)
      window.removeEventListener('pointerdown', before, true)
      window.removeEventListener('keydown', before, true)
    }
  }, [])
  const placedFor = useRef<string | null>(null)
  const wasLoading = useRef(props.loading)
  useLayoutEffect(() => {
    const node = scroller.current
    // A load that ended puts the place back, as it always did: the rows were
    // gone meanwhile and the box may have been held at the top.
    const loaded = wasLoading.current && !props.loading
    wasLoading.current = props.loading
    if (!node || props.loading) return
    const folder = placedFor.current !== props.directory
    placedFor.current = props.directory
    const own = folder || loaded
    // App's echo of a place the list told it: the box may already be past it.
    if (!own && props.scrollTop === told.current) return
    if (!own && node.hasAttribute('data-sweeping')) return
    // A new folder: a place not yet told belonged to the last one.
    if (folder) untold.current = null
    told.current = props.scrollTop
    if (Math.abs(node.scrollTop - props.scrollTop) >= 1) node.scrollTop = props.scrollTop
    // Where the box could go: a shorter folder holds it nearer the top.
    setTop(node.scrollTop)
  }, [props.directory, props.scrollTop, props.loading])

  // DOWNLOADS' DATE GROUPS (#285): a divider is a row of the list's own
  // height, so the rows below it simply move down one index; `rowAt` answers
  // null on it, which every walk of the list (arrows, Home and End, a pending
  // focus, the sweep) already steps over.
  const divided = useMemo(
    () =>
      props.dividers?.length && !props.indexedRows
        ? divideRows(props.entries.length, props.dividers)
        : null,
    [props.dividers, props.indexedRows, props.entries.length]
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
  const spaceHeight = Math.min(count * rowHeight, 4000000)
  const scale = Math.max(1, (count * rowHeight - height) / Math.max(1, spaceHeight - height))
  const logicalTop =
    top >= spaceHeight - height - 1
      ? Math.max(0, count * rowHeight - height)
      : top * scale
  const loadedSelectedIndex = props.indexedRows
    ? ([...props.indexedRows].find(([, entry]) => entry?.path === props.selectedPath)?.[0] ?? -1)
    : (() => {
        const at = props.entries.findIndex((entry) => entry.path === props.selectedPath)
        return divided && at >= 0 ? divided.rowOf(at) : at
      })()
  const selectedIndex = loadedSelectedIndex
  useLayoutEffect(() => {
    if (loadedSelectedIndex >= 0 && props.selectedPath)
      selectionPosition.current = { path: props.selectedPath, index: loadedSelectedIndex }
  }, [loadedSelectedIndex, props.selectedPath])
  const first = Math.max(0, Math.floor(logicalTop / rowHeight) - OVERSCAN)
  const end = Math.min(count, Math.ceil((logicalTop + height) / rowHeight) + OVERSCAN)
  const rowAt = (index: number): BrowseEntry | null | undefined => {
    if (props.indexedRows) return props.indexedRows.get(index)
    if (!divided) return props.entries[index]
    const at = divided.entryAt(index)
    return at === null ? null : props.entries[at]
  }
  const rendered = Array.from({ length: Math.max(0, end - first) }, (_, index) =>
    rowAt(first + index)
  )
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
  const geometry = useRef({ count, spaceHeight, height, scale, rowHeight })
  const rowAtRef = useRef(rowAt)
  /** What React draws as marked now: during a sweep, still what was marked
   *  before it (#332, the sweep's own marks are the hook's). */
  const isMarked = (path: string): boolean =>
    props.marked ? props.marked.has(path) : path === props.selectedPath
  const heldRef = useRef(isMarked)
  // Mirrored after render (refs are not written while rendering); the sweep
  // reads them from pointer events, which only come after.
  useLayoutEffect(() => {
    geometry.current = { count, spaceHeight, height, scale, rowHeight }
    rowAtRef.current = rowAt
    heldRef.current = isMarked
  })
  /** The list's top, in row coordinates, for a scroll position: the rule the
   *  render uses, so the rectangle and the rows agree when the list is huge. */
  const logicalTopAt = (top: number): number => {
    const g = geometry.current
    return top >= g.spaceHeight - g.height - 1
      ? Math.max(0, g.count * g.rowHeight - g.height)
      : top * g.scale
  }
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
        scrollWidth: node.scrollWidth
      }
    },
    toList: (x, y, m) => {
      const g = geometry.current
      return {
        x: Math.min(m.scrollWidth, Math.max(0, x - m.left + m.scrollLeft)),
        y: Math.max(0, Math.min(Math.max(g.count * g.rowHeight, g.height), logicalTopAt(m.scrollTop) + y - m.top))
      }
    },
    // Row coordinates to the screen: row y sits at the box's top plus
    // (y - logicalTop). From the measured scroll, not the rendered one, so it
    // holds while the list auto-scrolls under it. Known and accepted: in the
    // compressed scroll (`scale > 1`, about 180k rows and up) the rows are
    // placed from the RENDERED scroll, a frame later, so while the list
    // auto-scrolls there the box and the rows can disagree for a frame by the
    // scroll step times `scale - 1`. Below that `logicalTopAt(s) === s`.
    toClient: (p, m) =>
      contentToClient(p, { x: m.left, y: m.top }, { x: m.scrollLeft, y: logicalTopAt(m.scrollTop) }),
    rowAcross: () => {
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
    span: (box, py, drawnAcross) => {
      const g = geometry.current
      const across = drawnAcross ?? { left: 0, right: scroller.current?.scrollWidth ?? 0 }
      const span = rowsInBox(box, { ...across, height: g.rowHeight }, g.count)
      return span && { ...span, near: nearestRow(py, g.rowHeight, span.first, span.last) }
    },
    pathsIn: (span) => {
      const paths: string[] = []
      for (let i = span.first; i <= span.last; i++) {
        const entry = rowAtRef.current(i)
        if (entry) paths.push(entry.path)
      }
      const near = rowAtRef.current(span.near)
      return { paths, near: near?.path ?? paths[paths.length - 1] ?? null }
    },
    // The rows drawn, in order. A marked run joins across the row drawn just
    // above or below, the render's own rule (a divider or a row still on its
    // way breaks it).
    rows: () => {
      const out: SweepRow[] = []
      const layer = scroller.current?.querySelector('.browse-row-layer')
      if (!layer) return out
      const real = (el: Element | null): { index: number; path: string } | null => {
        const path = el?.getAttribute('data-browse-path')
        return el && path ? { index: Number(el.getAttribute('data-browse-index')), path } : null
      }
      for (const el of layer.children) {
        const me = real(el)
        if (me)
          out.push({
            el: el as HTMLElement,
            ...me,
            up: real(el.previousElementSibling),
            down: real(el.nextElementSibling)
          })
      }
      return out
    },
    held: (path) => heldRef.current(path),
    scrollBy: (dy) => {
      const node = scroller.current
      if (!node) return
      node.scrollTop += dy / geometry.current.scale
    },
    onEnd: (paths, near, add) => {
      flushScroll()
      props.onSweep?.(paths, near, add)
    },
    onCancel: () => flushScroll()
  })
  const onListPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || props.loading || props.message || !props.onSweep) return
    // A file's row, every cell of it and the gaps between: its own drag.
    if ((e.target as HTMLElement).closest('.browse-row[data-browse-path]')) return
    sweep.begin(e)
  }
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
  useLayoutEffect(() => {
    const top = Math.floor(logicalTop / rowHeight)
    const visibleCount = Math.ceil(height / rowHeight) + 1
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
  }, [props.entries, divided, logicalTop, height, onVisibleFolders, indexed, rowHeight])
  const onSelect = props.onSelect
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
      node.scrollTop = Math.max(0, (count * rowHeight - height) / scale)
      if (node.scrollTop !== top) scrolledTo(node.scrollTop)
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
  }, [props.indexedRows, props.entries, divided, onSelect, onSearchRange, count, scale, top, height, rowHeight])
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
  const indexOfPath = (path: string): number => {
    if (props.indexedRows)
      return [...props.indexedRows].find(([, entry]) => entry?.path === path)?.[0] ?? -1
    const at = props.entries.findIndex((entry) => entry.path === path)
    return divided && at >= 0 ? divided.rowOf(at) : at
  }
  /** Bring a row into view, stepping off a divider the way `toward` points;
   *  the row's entry, or null when it is not there to land on. */
  const reveal = (index: number, toward: 1 | -1): { index: number; entry: BrowseEntry } | null => {
    const node = scroller.current
    if (!node) return null
    while (index >= 0 && index < count && rowAt(index) === null) index += toward
    if (index < 0 || index >= count) return null
    const top = (divided?.divider(index - 1) ? index - 1 : index) * rowHeight
    const visibleTop = node.scrollTop * scale
    if (top < visibleTop) node.scrollTop = top / scale
    else if (index * rowHeight + rowHeight > visibleTop + node.clientHeight)
      node.scrollTop = (index * rowHeight + rowHeight - node.clientHeight) / scale
    scrolledTo(node.scrollTop)
    const entry = rowAt(index)
    if (!entry) return null
    requestAnimationFrame(() =>
      node.querySelector<HTMLElement>(`[data-browse-index="${index}"]`)?.focus({ preventScroll: true })
    )
    return { index, entry }
  }
  const focusRow = (index: number): void => {
    const node = scroller.current
    if (!node) return
    setCursor(null)
    const direction = index === 0 ? 1 : index < selectedIndex || index === count - 1 ? -1 : 1
    while (index >= 0 && index < count && rowAt(index) === null) index += direction
    if (index < 0 || index >= count) return
    // A group's first row going up brings its divider into view with it.
    const top = (divided?.divider(index - 1) ? index - 1 : index) * rowHeight
    const visibleTop = node.scrollTop * scale
    if (top < visibleTop) node.scrollTop = top / scale
    else if (index * rowHeight + rowHeight > visibleTop + node.clientHeight)
      node.scrollTop = (index * rowHeight + rowHeight - node.clientHeight) / scale
    scrolledTo(node.scrollTop)
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
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const common = listKey(e)
    if (common) {
      // Escape is a nearer closer's first (a peek, the PDF's find bar, a
      // menu): those listen on the window, after this (review of #330).
      if (common === 'clear' && e.key === 'Escape' && nearerEscape()) return
      if (LIST_OWN.has(common) && listOwnKey(common)) {
        // Claimed: the player's window-wide keys (Ctrl+Space is play, Shift+
        // Home a seek) yield to a key the list took.
        e.preventDefault()
        e.stopPropagation()
      }
      return
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
    const page = Math.max(1, Math.floor(height / rowHeight) - 1)
    const rememberedIndex =
      selectedIndex >= 0
        ? selectedIndex
        : selectionPosition.current.path === props.selectedPath
          ? selectionPosition.current.index
          : -1
    // The plain arrows carry on from a cursor the Ctrl keys moved (#330).
    const cursorIndex = cursor !== null ? indexOfPath(cursor) : -1
    const currentIndex =
      pendingFocus.current ??
      (cursorIndex >= 0
        ? cursorIndex
        : rememberedIndex < 0
          ? Math.floor(logicalTop / rowHeight) - 1
          : rememberedIndex)
    let next: number
    if (e.key === 'ArrowDown') next = Math.min(count - 1, currentIndex + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, currentIndex - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    else if (e.key === 'PageDown') next = Math.min(count - 1, Math.max(0, currentIndex) + page)
    else if (e.key === 'PageUp') next = Math.max(0, currentIndex - page)
    else if ((e.key === 'Enter' || e.key === ' ') && props.selectedPath) {
      e.preventDefault()
      e.stopPropagation()
      const entry =
        rowAt(selectedIndex) ?? props.entries.find((entry) => entry.path === props.selectedPath)
      if (e.key === 'Enter' && entry) props.onActivate(entry)
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

  return (
    <div
      className="browse-list-area"
      data-searching={searching || undefined}
      data-in-archive={(!!props.archive && !searching) || undefined}
      data-row-size={sizeId}
      data-pending={props.pending && props.pending !== 'none' ? props.pending : undefined}
      style={
        {
          '--browse-row-h': `${look.height}px`,
          '--browse-row-font': `${look.font}px`,
          '--browse-row-icon': `${look.icon}px`,
          '--browse-row-gap': `${look.gap}px`,
          '--browse-row-pad': `${look.padX}px`,
          ...explorerHeadVars(sizeId)
        } as CSSProperties
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
          if (scroller.current && scroller.current.scrollLeft !== event.currentTarget.scrollLeft)
            scroller.current.scrollLeft = event.currentTarget.scrollLeft
        }}
      >
        <div className="browse-columns">
          {(searching ? searchColumns : props.archive ? archiveColumns : columns).map(({ key, label }) => (
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
      <div className="browse-progress" aria-hidden="true" data-on={props.pending === 'slow' || undefined} />
      <div
        ref={scroller}
        className="browse-list"
        role="listbox"
        aria-label={
          searching
            ? `Search results in ${props.directory} and subfolders`
            : `Files in ${props.directory}`
        }
        aria-busy={props.loading || !!props.searchState?.running}
        tabIndex={selectedIndex < first || selectedIndex >= end ? 0 : -1}
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
          // Drawn now; told to App when it comes to rest (above).
          setTop(e.currentTarget.scrollTop)
          if (!props.loading) untold.current = e.currentTarget.scrollTop
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
          // The empty space's own menu, inside an archive (#300). A row's
          // menu stops here first.
          if (!props.onEmptyContextMenu || (e.target as HTMLElement).closest('.browse-row')) return
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
            <div
              className="browse-row-layer"
              style={{
                transform: `translateY(${top + first * rowHeight - logicalTop}px)`
              }}
            >
              {rendered.map((entry, offset) => {
                const divider = divided?.divider(first + offset)
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
                      key={`pending-${first + offset}`}
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
                      (divided ? (divided.entryAt(first + offset) ?? 0) : first + offset) + 1
                    }
                    aria-setsize={divided ? props.entries.length : count}
                    tabIndex={primary ? 0 : -1}
                    className="browse-row"
                    data-cut={cut.has(entry.path.toLowerCase()) || undefined}
                    aria-description={
                      [
                        groupOf?.[divided?.entryAt(first + offset) ?? -1],
                        cut.has(entry.path.toLowerCase()) ? 'Cut' : ''
                      ]
                        .filter(Boolean)
                        .join(', ') || undefined
                    }
                    data-browse-path={entry.path}
                    data-browse-index={first + offset}
                    data-selected={selected || undefined}
                    data-cursor={(cursor === entry.path && !primary) || undefined}
                    data-join-up={joinUp || undefined}
                    data-join-down={joinDown || undefined}
                    draggable
                    {...folderDrop(
                      entry.isFolder ? entry.path : (browseParent(entry.path) ?? props.directory),
                      entry.path
                    )}
                    onDragStart={(event) => {
                      // A row inside a multi-selection carries all of it,
                      // the tree's rule.
                      const all = props.marked
                      const paths = all && all.size > 1 && all.has(entry.path) ? [...all] : [entry.path]
                      // Rows inside an archive are its MEMBERS (#300): dropped on
                      // a real folder they extract there, the archive view's own
                      // drag; dropped inside the same zip they move.
                      const archive = props.archive
                      const entries = archive
                        ? paths.map((p) => memberOf(archive, p)).filter((p): p is string => !!p)
                        : []
                      if (archive && entries.length) {
                        setDrag({ kind: 'members', archive: archive.container, entries })
                        event.dataTransfer.effectAllowed = 'copyMove'
                        event.dataTransfer.setData(DRAG_MIME, 'members')
                        return
                      }
                      setDrag({ kind: 'files', paths })
                      event.dataTransfer.effectAllowed = 'copyMove'
                      event.dataTransfer.setData(DRAG_MIME, 'files')
                    }}
                    onDragEnd={() => setDrag(null)}
                    title={searching ? entry.path : entry.name}
                    onClick={(e: ReactMouseEvent) => {
                      setCursor(null)
                      if ((e.ctrlKey || e.shiftKey) && props.onPick)
                        props.onPick(entry, { ctrl: e.ctrlKey, shift: e.shiftKey })
                      else props.onSelect(entry.path)
                    }}
                    onDoubleClick={() => props.onActivate(entry)}
                    onPointerEnter={
                      entry.isFolder && props.onFolderHover
                        ? () => props.onFolderHover?.(entry.path)
                        : undefined
                    }
                    onPointerLeave={
                      entry.isFolder && props.onFolderHover
                        ? () => props.onFolderHover?.(null)
                        : undefined
                    }
                    onContextMenu={(e) => {
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
                    }}
                  >
                    <span className="browse-column-name browse-name">
                      {entry.isFolder ? (
                        <FolderIcon color="var(--p-tree-folder)" />
                      ) : (
                        entry.file && (
                          // A marked row is a tint, so its icon keeps its own
                          // colours; its knockouts are the tint as seen
                          // (dimmed or not, swept or not: browse.css sets
                          // --browse-row-ground).
                          <KindIcon
                            kind={entry.file.kind}
                            ext={entry.file.ext}
                            name={entry.name}
                            color={iconColour(entry.file.kind)}
                            size={look.icon}
                            bg="var(--browse-row-ground, var(--p-bg))"
                          />
                        )
                      )}
                      <span className="browse-name-text">
                        <span>{entry.name}</span>
                      </span>
                    </span>
                    <span
                      className={
                        searching
                          ? 'browse-column-path browse-result-location'
                          : 'browse-column-type'
                      }
                    >
                      {searching
                        ? (browseParent(entry.path) ?? entry.path)
                        : typeLabel(entry.name, entry.isFolder)}
                    </span>
                    <span
                      className="browse-column-size"
                      title={entry.folderSize ? folderSizeCoverage(entry.folderSize) : undefined}
                    >
                      {/* No size yet is a blank cell, never "0 B" (#271). */}
                      {entry.file
                        ? entry.file.size === undefined
                          ? ''
                          : formatBytes(entry.file.size)
                        : folderSizeLabel(entry.folderSize)}
                    </span>
                    {!!props.archive && !searching && (
                      <span className="browse-column-packed">
                        {entry.file?.packed !== undefined ? formatBytes(entry.file.packed) : ''}
                      </span>
                    )}
                    {!searching && (
                      <span className="browse-column-modified">
                        {/* A folder's date too, now it has one (#285). */}
                        {formatWhen(entry.file ? entry.file.mtimeMs : entry.mtimeMs)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
      {/* Over the list, not in it (#332): the box never re-rasters the rows. */}
      {sweep.sweeping && <SweepBand bandRef={sweep.bandRef} />}
      <OverlayScrollbar target={scroller} />
    </div>
  )
}
