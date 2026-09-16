import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { formatBytes, formatWhen } from '../../lib/format'
import { typeLabel } from '../../lib/typeLabel'
import { browseParent } from '../../lib/browse'
import { useFileCut } from '../../lib/fileClipboard'
import { DRAG_MIME, setDrag } from '../../lib/dragDrop'
import { FolderIcon, KindIcon, iconColour } from '../TreeRows'
import { BrowseIcon } from './BrowseIcon'
import { BrowseSearchStatus } from './BrowseSearchStatus'
import { useFolderDrop } from './useFolderDrop'
import type { BrowseEntry, BrowseSort, FolderBrowserProps } from './types'

const OVERSCAN = 12
const columns: Array<{ key: BrowseSort['key']; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'size', label: 'Size' },
  { key: 'modified', label: 'Date modified' }
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
  | 'onDropInto'
> & {
  entries: BrowseEntry[]
  onActivate: (entry: BrowseEntry) => void
  message: string | null
  loading: boolean
}

export function BrowseList(props: Props): JSX.Element {
  const cut = useFileCut()
  const folderDrop = useFolderDrop(props.loading ? undefined : props.onDropInto)
  const searching = !!props.query.trim()
  const rowHeight = searching ? 60 : 40
  const scroller = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(600)
  const typed = useRef({ text: '', at: 0 })
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

  const selectedIndex = props.entries.findIndex((entry) => entry.path === props.selectedPath)
  const first = Math.max(0, Math.floor(props.scrollTop / rowHeight) - OVERSCAN)
  const end = Math.min(
    props.entries.length,
    Math.ceil((props.scrollTop + height) / rowHeight) + OVERSCAN
  )
  const rendered = props.entries.slice(first, end)
  const focusRow = (index: number): void => {
    const entry = props.entries[index]
    const node = scroller.current
    if (!entry || !node) return
    props.onSelect(entry.path)
    const top = index * rowHeight
    if (top < node.scrollTop) node.scrollTop = top
    else if (top + rowHeight > node.scrollTop + node.clientHeight)
      node.scrollTop = top + rowHeight - node.clientHeight
    props.onScroll(node.scrollTop)
    requestAnimationFrame(() =>
      node
        .querySelector<HTMLElement>(`[data-browse-index="${index}"]`)
        ?.focus({ preventScroll: true })
    )
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const count = props.entries.length
    if (!count) return
    const page = Math.max(1, Math.floor(height / rowHeight) - 1)
    let next: number
    if (e.key === 'ArrowDown') next = Math.min(count - 1, selectedIndex + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, selectedIndex - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    else if (e.key === 'PageDown') next = Math.min(count - 1, Math.max(0, selectedIndex) + page)
    else if (e.key === 'PageUp') next = Math.max(0, selectedIndex - page)
    else if ((e.key === 'Enter' || e.key === ' ') && selectedIndex >= 0) {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Enter') props.onActivate(props.entries[selectedIndex])
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
      next = match
    } else return
    e.preventDefault()
    e.stopPropagation()
    focusRow(next)
  }

  return (
    <div className="browse-list-area" data-searching={searching || undefined}>
      {searching && (
        <BrowseSearchStatus state={props.searchState} onCancel={props.onCancelSearch} />
      )}
      <div className="browse-columns">
        {columns.map(({ key, label }) => (
          <button
            key={key}
            className={`browse-column-${key}`}
            title={`Sort by ${label.toLowerCase()}`}
            aria-label={`Sort by ${label.toLowerCase()}${props.sort.key === key ? `, ${props.sort.direction === 'asc' ? 'ascending' : 'descending'}` : ''}`}
            onClick={() =>
              props.onSortChange({
                key,
                direction: props.sort.key === key && props.sort.direction === 'asc' ? 'desc' : 'asc'
              })
            }
          >
            {label}
            {props.sort.key === key && (
              <span className="browse-sort-arrow" data-descending={props.sort.direction === 'desc'}>
                <BrowseIcon name="up" />
              </span>
            )}
          </button>
        ))}
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
            style={{ height: props.entries.length * rowHeight }}
            onClick={(e) => {
              if (e.target === e.currentTarget) props.onSelect(null)
            }}
          >
            <div style={{ transform: `translateY(${first * rowHeight}px)` }}>
              {rendered.map((entry, offset) => {
                const selected = entry.path === props.selectedPath
                const highlighted = selected || entry.path === props.menuPath
                return (
                  <button
                    key={entry.path}
                    role="option"
                    aria-selected={selected}
                    aria-posinset={first + offset + 1}
                    aria-setsize={props.entries.length}
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
                    {...folderDrop(entry.isFolder ? entry.path : browseParent(entry.path) ?? props.directory, entry.path)}
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
                        {searching && (
                          <span className="browse-result-location">
                            {browseParent(entry.path) ?? entry.path}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="browse-column-type">
                      {typeLabel(entry.name, entry.isFolder)}
                    </span>
                    <span className="browse-column-size">
                      {entry.file ? formatBytes(entry.file.size) : ''}
                    </span>
                    <span className="browse-column-modified">
                      {entry.file ? formatWhen(entry.file.mtimeMs) : ''}
                    </span>
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
