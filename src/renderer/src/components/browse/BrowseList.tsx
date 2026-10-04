import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { formatBytes, formatWhen } from '../../lib/format'
import { folderSizeCoverage, folderSizeLabel } from '../../lib/folderSize'
import { typeLabel } from '../../lib/typeLabel'
import { browseParent } from '../../lib/browse'
import { useFileCut } from '../../lib/fileClipboard'
import { DRAG_MIME, setDrag } from '../../lib/dragDrop'
import { FolderIcon, KindIcon, SweepBand, iconColour } from '../TreeRows'
import { OverlayScrollbar } from './OverlayScrollbar'
import { explorerHeadVars, explorerRow, useExplorerSize } from '../../lib/explorerSize'
import { bandBox, nearestRow, onRowOwnPart, rowsInBand } from '../../lib/marquee'
import { useSweep } from '../../hooks/useSweep'
import { BrowseIcon } from './BrowseIcon'
import { useFolderDrop } from './useFolderDrop'
import type { BrowseEntry, BrowseSort, FolderBrowserProps } from './types'
import type { ListPending } from '../../lib/usePendingHint'
import { divideRows, type DateDivider } from '../../lib/dateGroups'
import { nextSort } from '../../lib/downloadsView'

const OVERSCAN = 12
const columns: Array<{ key: BrowseSort['key']; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size' },
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
  | 'menuPath'
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
  useLayoutEffect(() => {
    if (scroller.current && !props.loading) scroller.current.scrollTop = props.scrollTop
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
    props.scrollTop >= spaceHeight - height - 1
      ? Math.max(0, count * rowHeight - height)
      : props.scrollTop * scale
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
   * THE SWEEP (#257). From the list's blank space (under the rows, or a row
   * to the right of its name, the other columns included) a drag draws the
   * rectangle and marks every row it touches, live. A press on a row's icon
   * or name is still the file's own drag, so a file still drags out to other
   * apps. Rows are found by index, never by element: only the rows in view
   * exist, and a row scrolled away under the rectangle is still in it.
   */
  const [sweeping, setSweeping] = useState<{ paths: string[]; add: boolean } | null>(null)
  const sweepAdd = useRef(false)
  const geometry = useRef({ count, spaceHeight, height, scale, rowHeight })
  const rowAtRef = useRef(rowAt)
  // Mirrored after render (refs are not written while rendering); the sweep
  // reads them from pointer events, which only come after.
  useLayoutEffect(() => {
    geometry.current = { count, spaceHeight, height, scale, rowHeight }
    rowAtRef.current = rowAt
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
    toList: (x, y) => {
      const node = scroller.current
      if (!node) return { x: 0, y: 0 }
      const r = node.getBoundingClientRect()
      const g = geometry.current
      return {
        x: Math.min(node.scrollWidth, Math.max(0, x - r.left + node.scrollLeft)),
        y: Math.max(0, Math.min(Math.max(g.count * g.rowHeight, g.height), logicalTopAt(node.scrollTop) + y - r.top))
      }
    },
    hitsBetween: (top, bottom, py) => {
      const g = geometry.current
      const span = rowsInBand(top, bottom, g.rowHeight, g.count)
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
    const el = e.target as HTMLElement
    const row = el.closest<HTMLElement>('.browse-row')
    if (row) {
      // The row up to the end of its name is the file's: it drags it, as
      // before. The other columns are blank space and sweep.
      const name = row.querySelectorAll('.browse-name > svg, .browse-name-text')
      if (onRowOwnPart(e.clientX, [...name].map((n) => n.getBoundingClientRect()))) return
    }
    sweepAdd.current = e.ctrlKey
    sweep.begin(e, row)
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
  const bandStyle = (() => {
    if (!sweep.band) return null
    // Row coordinates to the scroll box's own: the rows sit at
    // scrollTop + (y - logicalTop). Clamped to what is in view, so a sweep
    // across a hundred thousand rows is still one small element.
    const b = bandBox(sweep.band)
    const top = props.scrollTop + b.top - logicalTop
    const lo = Math.max(top, props.scrollTop - 2)
    const hi = Math.min(top + b.height, props.scrollTop + height + 2)
    return { x0: b.left, x1: b.left + b.width, y0: lo, y1: Math.max(lo, hi) }
  })()
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
  const onScroll = props.onScroll
  const scrollTop = props.scrollTop
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
  }, [props.indexedRows, props.entries, divided, onSelect, onScroll, onSearchRange, count, scale, scrollTop, height, rowHeight])
  useLayoutEffect(() => {
    pendingFocus.current = null
    selectionPosition.current = { path: '', index: -1 }
  }, [props.directory, props.query, props.sort])
  const focusRow = (index: number): void => {
    const node = scroller.current
    if (!node) return
    const direction = index === 0 ? 1 : index < selectedIndex || index === count - 1 ? -1 : 1
    while (index >= 0 && index < count && rowAt(index) === null) index += direction
    if (index < 0 || index >= count) return
    // A group's first row going up brings its divider into view with it.
    const top = (divided?.divider(index - 1) ? index - 1 : index) * rowHeight
    const visibleTop = node.scrollTop * scale
    if (top < visibleTop) node.scrollTop = top / scale
    else if (index * rowHeight + rowHeight > visibleTop + node.clientHeight)
      node.scrollTop = (index * rowHeight + rowHeight - node.clientHeight) / scale
    props.onScroll(node.scrollTop)
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
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
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
    const currentIndex =
      pendingFocus.current ??
      (rememberedIndex < 0 ? Math.floor(logicalTop / rowHeight) - 1 : rememberedIndex)
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
      <div
        className="browse-column-viewport"
        ref={columnScroller}
        onScroll={(event) => {
          if (scroller.current && scroller.current.scrollLeft !== event.currentTarget.scrollLeft)
            scroller.current.scrollLeft = event.currentTarget.scrollLeft
        }}
      >
        <div className="browse-columns">
          {(searching ? searchColumns : columns).map(({ key, label }) => (
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
          if (!props.loading) props.onScroll(e.currentTarget.scrollTop)
        }}
        // Empty space clears the pick QUIETLY: it is not a request to stop what
        // the preview plays (owner, 2026-10-03: "i should have to click the
        // video or the pause icon"). A right press on an unmarked row too.
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onSelect(null, true)
        }}
      >
        {props.message ? (
          <div className="browse-message" role="status">
            {props.message}
          </div>
        ) : (
          <div
            className="browse-row-space"
            style={{ height: spaceHeight }}
            onClick={(e) => {
              if (e.target === e.currentTarget) props.onSelect(null, true)
            }}
          >
            <div
              style={{
                transform: `translateY(${props.scrollTop + first * rowHeight - logicalTop}px)`
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
                const onMenu = entry.path === props.menuPath
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
                    data-join-up={joinUp || undefined}
                    data-join-down={joinDown || undefined}
                    data-menu={onMenu || undefined}
                    draggable
                    {...folderDrop(
                      entry.isFolder ? entry.path : (browseParent(entry.path) ?? props.directory),
                      entry.path
                    )}
                    onDragStart={(event) => {
                      // A row inside a multi-selection carries all of it,
                      // the tree's rule.
                      const all = props.marked
                      setDrag({
                        kind: 'files',
                        paths: all && all.size > 1 && all.has(entry.path) ? [...all] : [entry.path]
                      })
                      event.dataTransfer.effectAllowed = 'copyMove'
                      event.dataTransfer.setData(DRAG_MIME, 'files')
                    }}
                    onDragEnd={() => setDrag(null)}
                    title={searching ? entry.path : entry.name}
                    onClick={(e: ReactMouseEvent) => {
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
                        if (!selected) props.onSelect(null, true)
                        props.onContextMenu(e, entry)
                      }
                    }}
                  >
                    <span className="browse-column-name browse-name">
                      {entry.isFolder ? (
                        <FolderIcon color={onMenu ? 'currentColor' : 'var(--p-tree-folder)'} />
                      ) : (
                        entry.file && (
                          // A marked row is a tint, so its icon keeps its own
                          // colours; only the menu's grey row still draws it
                          // in the row's ink, as it always has. Its knockouts
                          // are that grey (browse.css [data-menu]), not the
                          // accent, or they show as accent spots on it.
                          <KindIcon
                            kind={entry.file.kind}
                            ext={entry.file.ext}
                            name={entry.name}
                            color={onMenu ? 'currentColor' : iconColour(entry.file.kind)}
                            selected={onMenu}
                            size={look.icon}
                            bg={onMenu ? 'color-mix(in srgb, var(--p-text) 14%, var(--p-bg))' : selected ? 'var(--p-sel-tint-seen)' : 'var(--p-bg)'}
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
        {bandStyle && <SweepBand band={bandStyle} as="div" />}
      </div>
      <OverlayScrollbar target={scroller} />
    </div>
  )
}
