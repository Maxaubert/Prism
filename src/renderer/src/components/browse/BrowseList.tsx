import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { formatBytes, formatWhen } from '../../lib/format'
import { folderSizeCoverage, folderSizeLabel } from '../../lib/folderSize'
import { typeLabel } from '../../lib/typeLabel'
import { browseParent } from '../../lib/browse'
import { useFileCut } from '../../lib/fileClipboard'
import { DRAG_MIME, setDrag } from '../../lib/dragDrop'
import { FolderIcon, KindIcon, iconColour } from '../TreeRows'
import { BrowseIcon } from './BrowseIcon'
import { useFolderDrop } from './useFolderDrop'
import type { BrowseEntry, BrowseSort, FolderBrowserProps } from './types'

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
  onVisibleFolders?: (paths: string[]) => void
}

export function BrowseList(props: Props): JSX.Element {
  const cut = useFileCut()
  const folderDrop = useFolderDrop(props.loading ? undefined : props.onDropInto)
  const searching = !!props.query.trim()
  const rowHeight = 40
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

  const count = props.total
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
    : props.entries.findIndex((entry) => entry.path === props.selectedPath)
  const selectedIndex = loadedSelectedIndex
  useLayoutEffect(() => {
    if (loadedSelectedIndex >= 0 && props.selectedPath)
      selectionPosition.current = { path: props.selectedPath, index: loadedSelectedIndex }
  }, [loadedSelectedIndex, props.selectedPath])
  const first = Math.max(0, Math.floor(logicalTop / rowHeight) - OVERSCAN)
  const end = Math.min(count, Math.ceil((logicalTop + height) / rowHeight) + OVERSCAN)
  const rowAt = (index: number): BrowseEntry | null | undefined =>
    props.indexedRows ? props.indexedRows.get(index) : props.entries[index]
  const rendered = Array.from({ length: Math.max(0, end - first) }, (_, index) =>
    rowAt(first + index)
  )
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
  }, [scale, height])
  useLayoutEffect(() => {
    if (indexed) onSearchRange?.(Math.floor(logicalTop / rowHeight))
  }, [indexed, logicalTop, onSearchRange])
  useLayoutEffect(() => {
    const top = Math.floor(logicalTop / rowHeight)
    const visibleCount = Math.ceil(height / rowHeight) + 1
    onVisibleFolders?.(
      indexed
        ? []
        : props.entries
            .slice(top, top + visibleCount)
            .filter((entry) => entry.isFolder)
            .map((entry) => entry.path)
    )
  }, [props.entries, logicalTop, height, onVisibleFolders, indexed])
  const onSelect = props.onSelect
  const onScroll = props.onScroll
  const scrollTop = props.scrollTop
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    const node = scroller.current
    if (pending === null || !count || !node) return
    let index = pending === Infinity ? count - 1 : Math.min(pending, count - 1)
    let entry = props.indexedRows ? props.indexedRows.get(index) : props.entries[index]
    const direction = pending === Infinity ? -1 : 1
    while (entry === null && index >= 0 && index < count) {
      index += direction
      entry = props.indexedRows?.get(index)
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
  }, [props.indexedRows, props.entries, onSelect, onScroll, onSearchRange, count, scale, scrollTop, height])
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
    const top = index * rowHeight
    const visibleTop = node.scrollTop * scale
    if (top < visibleTop) node.scrollTop = top / scale
    else if (top + rowHeight > visibleTop + node.clientHeight)
      node.scrollTop = (top + rowHeight - node.clientHeight) / scale
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
        : match
      if (next < 0) return
    } else return
    e.preventDefault()
    e.stopPropagation()
    focusRow(next)
  }

  return (
    <div className="browse-list-area" data-searching={searching || undefined}>
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
              onClick={() =>
                props.onSortChange({
                  key,
                  direction:
                    props.sort.key === key && props.sort.direction === 'asc' ? 'desc' : 'asc'
                })
              }
            >
              {label}
              {props.sort.key === key && (
                <span
                  className="browse-sort-arrow"
                  data-descending={props.sort.direction === 'desc'}
                >
                  <BrowseIcon name="up" />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
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
        onScroll={(e) => {
          if (
            columnScroller.current &&
            columnScroller.current.scrollLeft !== e.currentTarget.scrollLeft
          )
            columnScroller.current.scrollLeft = e.currentTarget.scrollLeft
          if (!props.loading) props.onScroll(e.currentTarget.scrollTop)
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onSelect(null)
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
              if (e.target === e.currentTarget) props.onSelect(null)
            }}
          >
            <div
              style={{
                transform: `translateY(${props.scrollTop + first * rowHeight - logicalTop}px)`
              }}
            >
              {rendered.map((entry, offset) => {
                if (!entry)
                  return (
                    <div
                      key={`pending-${first + offset}`}
                      className="browse-row"
                      aria-hidden="true"
                      data-striped={(first + offset) % 2 === 1 || undefined}
                    >
                      <span className="browse-column-name browse-name">
                        {entry === null ? 'Item unavailable' : 'Loading\u2026'}
                      </span>
                    </div>
                  )
                const selected = entry.path === props.selectedPath
                const highlighted = selected || entry.path === props.menuPath
                return (
                  <button
                    key={entry.path}
                    role="option"
                    aria-selected={selected}
                    aria-posinset={first + offset + 1}
                    aria-setsize={count}
                    tabIndex={selected ? 0 : -1}
                    className="browse-row"
                    data-cut={cut.has(entry.path.toLowerCase()) || undefined}
                    aria-description={cut.has(entry.path.toLowerCase()) ? 'Cut' : undefined}
                    data-browse-path={entry.path}
                    data-browse-index={first + offset}
                    data-selected={selected || undefined}
                    data-menu={entry.path === props.menuPath || undefined}
                    data-striped={(first + offset) % 2 === 1 || undefined}
                    draggable
                    {...folderDrop(
                      entry.isFolder ? entry.path : (browseParent(entry.path) ?? props.directory),
                      entry.path
                    )}
                    onDragStart={(event) => {
                      setDrag({ kind: 'files', paths: [entry.path] })
                      event.dataTransfer.effectAllowed = 'copyMove'
                      event.dataTransfer.setData(DRAG_MIME, 'files')
                    }}
                    onDragEnd={() => setDrag(null)}
                    title={searching ? entry.path : entry.name}
                    onClick={() => props.onSelect(entry.path)}
                    onDoubleClick={() => props.onActivate(entry)}
                    onContextMenu={(e) => {
                      if (props.onContextMenu) {
                        e.preventDefault()
                        if (!selected) props.onSelect(null)
                        props.onContextMenu(e, entry)
                      }
                    }}
                  >
                    <span className="browse-column-name browse-name">
                      {entry.isFolder ? (
                        <FolderIcon color={highlighted ? 'currentColor' : 'var(--p-tree-folder)'} />
                      ) : (
                        entry.file && (
                          <KindIcon
                            kind={entry.file.kind}
                            ext={entry.file.ext}
                            name={entry.name}
                            color={highlighted ? 'currentColor' : iconColour(entry.file.kind)}
                            selected={highlighted}
                            size={18}
                            bg={highlighted ? 'var(--p-sel-bg)' : 'var(--p-bg)'}
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
                      {entry.file
                        ? formatBytes(entry.file.size)
                        : folderSizeLabel(entry.folderSize)}
                    </span>
                    {!searching && (
                      <span className="browse-column-modified">
                        {entry.file ? formatWhen(entry.file.mtimeMs) : ''}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
