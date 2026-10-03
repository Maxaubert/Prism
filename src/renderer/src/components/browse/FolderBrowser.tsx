import { useCallback, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { formatBytes } from '../../lib/format'
import { BrowseIcon } from './BrowseIcon'
import { BrowseList } from './BrowseList'
import { BrowseSearchStatus } from './BrowseSearchStatus'
import { BrowsePlaces } from './BrowsePlaces'
import { BrowseToolbar } from './BrowseToolbar'
import { browseEntries } from './entries'
import { useFolderSizes } from '../../hooks/useFolderSizes'
import { clickSelect } from '../../lib/selection'
import { sweepSelect } from '../../lib/marquee'
import type { BrowseEntry, FolderBrowserProps } from './types'
import './browse.css'

export type {
  BrowseEntry,
  BrowsePlace,
  BrowseSearchState,
  BrowseSort,
  FolderBrowserProps
} from './types'

/** The accepted folder layout extends Prism's own continuous canvas and file rows.
 * Location, history and selection belong to the tab; this surface owns no session.
 * The preview slot can be empty when App positions its existing mounted viewer over it.
 */
export function FolderBrowser(props: FolderBrowserProps): JSX.Element {
  const shell = useRef<HTMLDivElement>(null)
  const [visibleFolders, setVisibleFolders] = useState<string[]>([])
  const onVisibleFolders = useCallback((paths: string[]) => {
    setVisibleFolders((previous) =>
      previous.length === paths.length && previous.every((path, index) => path === paths[index])
        ? previous
        : paths
    )
  }, [])
  const focusList = (): void => {
    shell.current?.querySelector<HTMLElement>('.browse-list')?.focus({ preventScroll: true })
  }
  const retainListFocus = (): void => {
    if (document.activeElement?.closest('.browse-list')) focusList()
  }
  // The list survives folder loads; its rows do not. It also takes the keyboard
  // when returning from a full-file viewer, before a row is available again.
  useLayoutEffect(() => {
    focusList()
  }, [])
  // While the places panel slides its column shrinks, but its contents keep
  // the width they had open (the Sidebar's own rule), so the rows do not
  // reflow on every frame. Read while it stands still, applied only mid-slide.
  const sliding = !!props.placesSliding
  useLayoutEffect(() => {
    if (sliding || props.placesVisible === false) return
    const width = shell.current?.querySelector<HTMLElement>('.browse-places')?.offsetWidth
    if (width) shell.current?.style.setProperty('--browse-places-frozen', `${width}px`)
  })
  const folderPaths = useMemo(
    () => props.listing?.folders.map((folder) => folder.path) ?? [],
    [props.listing]
  )
  const folderSizes = useFolderSizes(
    folderPaths,
    !props.loading && !props.searchState?.running && !props.searchState?.window,
    visibleFolders
  )
  const entries = useMemo(
    () =>
      browseEntries(props.listing, props.searchState ? '' : props.query, props.sort, folderSizes),
    [props.listing, props.query, props.sort, props.searchState, folderSizes]
  )
  const selected = entries.find((entry) => entry.path === props.selectedPath)
  const searchWindow = props.searchState?.window
  const searchWindows = props.searchState?.windows
  const indexedRows = useMemo(() => {
    if (!searchWindow) return undefined
    const byPath = new Map(entries.map((entry) => [entry.path, entry]))
    const rows = new Map<number, BrowseEntry | null>()
    for (const window of searchWindows ?? []) {
      window.paths.forEach((path, index) => {
        const entry = path ? byPath.get(path) : null
        rows.set(
          window.offset + index,
          entry
            ? {
                ...entry,
                folderSize: window.folderSizes?.[entry.path] ?? null
              }
            : null
        )
      })
    }
    return rows
  }, [entries, searchWindow, searchWindows])
  const total = props.searchState?.window?.total ?? entries.length
  /**
   * MORE THAN ONE ROW MARKED (#257). The tab keeps ONE selected path, the
   * keyboard's place and what the preview shows; a sweep or a Ctrl or Shift
   * click marks more rows around it, held here. It belongs to the folder on
   * screen and goes with it: a new folder, a search or a new sort starts with
   * the one path again, and so does any plain pick (a click, the arrows).
   * Marks that no longer hold the selected path are stale and read as none.
   */
  const [marks, setMarks] = useState<{ key: string; items: ReadonlySet<string> } | null>(null)
  const anchor = useRef<string | null>(null)
  const marksKey = `${props.directory}\u0000${props.query}\u0000${props.sort.key}${props.sort.direction}`
  const marked =
    marks && marks.key === marksKey && props.selectedPath && marks.items.has(props.selectedPath)
      ? marks.items
      : null
  const markedEntries = marked ? entries.filter((entry) => marked.has(entry.path)) : []
  const many = markedEntries.length > 1
  const markedPaths = (): string[] => markedEntries.map((entry) => entry.path)
  const pickOne = (path: string | null): void => {
    setMarks(null)
    anchor.current = path
    props.onSelect(path)
  }
  const order = (): string[] =>
    indexedRows
      ? [...indexedRows]
          .sort(([a], [b]) => a - b)
          .flatMap(([, entry]) => (entry ? [entry.path] : []))
      : entries.map((entry) => entry.path)
  const pick = (entry: BrowseEntry, mods: { ctrl: boolean; shift: boolean }): void => {
    const now = marked ?? new Set(props.selectedPath ? [props.selectedPath] : [])
    const next = clickSelect(
      order(),
      { anchor: anchor.current ?? props.selectedPath, items: now },
      entry.path,
      mods
    )
    anchor.current = next.anchor
    // The clicked row is where the keyboard goes, unless Ctrl just took it
    // back out; then any row still marked, or none.
    const primary = next.items.has(entry.path) ? entry.path : ([...next.items][0] ?? null)
    setMarks(next.items.size > 1 ? { key: marksKey, items: next.items } : null)
    props.onSelect(primary)
  }
  const swept = (paths: string[], near: string | null, add: boolean): void => {
    const base: ReadonlySet<string> = add
      ? (marked ?? new Set(props.selectedPath ? [props.selectedPath] : []))
      : new Set()
    const items = sweepSelect(base, paths)
    if (items.size <= 1) return pickOne([...items][0] ?? null)
    const primary = near && items.has(near) ? near : [...items][0]
    anchor.current = primary
    setMarks({ key: marksKey, items })
    props.onSelect(primary)
  }
  const activate = (entry: BrowseEntry): void => {
    if (entry.isFolder) {
      retainListFocus()
      props.onNavigate(entry.path)
    } else if (entry.file) props.onOpen(entry.file)
  }
  const message = props.loading
    ? 'Loading folder…'
    : props.error ||
      (props.listing?.unreadable
        ? 'This folder could not be read. Try another location.'
        : !total
          ? props.query.trim()
            ? props.searchState?.running
              ? 'Searching this folder and subfolders…'
              : props.searchState?.cancelled || props.searchState?.truncated
                ? 'No matches found before the search stopped. Refine your search and try again.'
                : 'No matching items in this folder or its subfolders.'
            : 'This folder is empty.'
          : null)

  return (
    <div
      ref={shell}
      className="folder-browser"
      data-preview={props.previewVisible || undefined}
      data-places-hidden={props.placesVisible === false || undefined}
      data-places-sliding={sliding || undefined}
      data-places-peek={props.placesPeek || undefined}
      data-testid="folder-browser"
      onKeyDown={(e) => {
        const target = e.target as HTMLElement
        const typing = target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.cm-editor,.xterm,[role="dialog"],[role="menu"]'
        )
        if (target.closest('[role="dialog"],[role="menu"]')) return
        const inList = !!target.closest('.browse-list')
        if (e.key === 'F5' && props.onRefresh) {
          e.preventDefault()
          e.stopPropagation()
          retainListFocus()
          props.onRefresh()
        } else if (
          !typing &&
          inList &&
          selected &&
          e.key === 'Delete' &&
          !e.ctrlKey &&
          !e.shiftKey &&
          props.onDelete
        ) {
          e.preventDefault()
          e.stopPropagation()
          if (many && props.onDeleteMany) props.onDeleteMany(markedPaths())
          else props.onDelete(selected)
        } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'l') {
          e.preventDefault()
          e.stopPropagation()
          shell.current
            ?.querySelector<HTMLButtonElement>('[data-testid="browse-edit-path"]')
            ?.click()
        } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
          e.preventDefault()
          e.stopPropagation()
          shell.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
        } else if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Backspace') {
          e.preventDefault()
          e.stopPropagation()
          retainListFocus()
          if (props.canBack) props.onBack()
          else props.onUp()
        } else if (!typing && e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(e.key)) {
          e.preventDefault()
          e.stopPropagation()
          retainListFocus()
          if (e.key === 'ArrowLeft' && props.canBack) props.onBack()
          if (e.key === 'ArrowRight' && props.canForward) props.onForward()
          if (e.key === 'ArrowUp') props.onUp()
        } else if (!typing && inList && selected && !many && e.key === 'F2' && props.onRename) {
          e.preventDefault()
          e.stopPropagation()
          props.onRename(selected)
        } else if (
          !typing &&
          inList &&
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          ['c', 'x', 'v'].includes(e.key.toLowerCase())
        ) {
          e.preventDefault()
          e.stopPropagation()
          const key = e.key.toLowerCase()
          if (key === 'v') props.onPaste?.(props.directory)
          else if (many && props.onCopyPaths) props.onCopyPaths(markedPaths(), key === 'x')
          else if (selected && key === 'x') props.onCut?.(selected)
          else if (selected) props.onCopy?.(selected)
        }
      }}
    >
      <BrowseToolbar {...props} />
      {(props.placesVisible !== false || sliding || !!props.placesPeek) && (
        <BrowsePlaces
          places={props.places}
          onDropInto={props.onDropInto}
          quickAccess={props.quickAccess}
          onQuickAccessFile={
            props.placesPeek && props.onQuickAccessFile
              ? (path, full) => {
                  props.onPlacePicked?.()
                  props.onQuickAccessFile?.(path, full)
                }
              : props.onQuickAccessFile
          }
          onPin={props.placesPeek === 'in' ? props.onPinPlaces : undefined}
          onUnpinQuickAccess={props.onUnpinQuickAccess}
          onMoveQuickAccess={props.onMoveQuickAccess}
          onPinQuickAccessPaths={props.onPinQuickAccessPaths}
          directory={props.directory}
          onNavigate={
            props.placesPeek
              ? (path) => {
                  props.onPlacePicked?.()
                  props.onNavigate(path)
                }
              : props.onNavigate
          }
          onNewTerminal={props.onNewTerminal}
          onOpenProject={props.onOpenProject}
          onOpenNewTab={props.onOpenNewTab}
        />
      )}
      <div className="browse-actions" aria-label="File actions">
        <button
          disabled={!selected || many || props.loading}
          onClick={() => {
            if (selected) activate(selected)
          }}
        >
          <BrowseIcon name="open" />
          <span>Open</span>
        </button>
        {props.onOpenProject && (
          <button
            disabled={!selected?.isFolder || many || props.loading}
            onClick={() => {
              if (selected?.isFolder) props.onOpenProject?.(selected)
            }}
            title="Open selected folder as a project"
          >
            <BrowseIcon name="open" />
            <span>Open as project</span>
          </button>
        )}
        {!props.onOpenProject && props.placesVisible === false && (
          <button onClick={() => props.onNewTerminal(props.directory)}>
            <BrowseIcon name="terminal" />
            <span>New terminal here</span>
          </button>
        )}
        {props.onCopy && (
          <button
            disabled={!selected || props.loading}
            onClick={() => {
              if (many && props.onCopyPaths) props.onCopyPaths(markedPaths(), false)
              else if (selected) props.onCopy?.(selected)
            }}
          >
            <BrowseIcon name="copy" />
            <span>Copy</span>
          </button>
        )}
        {props.onRename && (
          <button
            disabled={!selected || many || props.loading}
            onClick={() => {
              if (selected) props.onRename?.(selected)
            }}
          >
            <BrowseIcon name="rename" />
            <span>Rename</span>
          </button>
        )}
        {props.onDelete && (
          <button
            disabled={!selected || props.loading}
            onClick={() => {
              if (many && props.onDeleteMany) props.onDeleteMany(markedPaths())
              else if (selected) props.onDelete?.(selected)
            }}
          >
            <BrowseIcon name="delete" />
            <span>Delete</span>
          </button>
        )}
        {props.onContextMenu && (
          <button
            className="browse-icon-button"
            aria-label="More file actions"
            title="More file actions"
            disabled={!selected || many || props.loading}
            onClick={(e) => {
              if (selected) props.onContextMenu?.(e, selected, 'more')
            }}
          >
            <BrowseIcon name="more" />
          </button>
        )}
        <div className="browse-terminal-controls">{props.terminalControls}</div>
        <button
          className="browse-icon-button"
          aria-label="Preview pane"
          title="Preview pane"
          aria-pressed={props.previewEnabled}
          onClick={props.onPreviewToggle}
        >
          <BrowseIcon name="preview" />
        </button>
      </div>
      <BrowseList
        {...props}
        entries={props.loading ? [] : entries}
        indexedRows={indexedRows}
        total={total}
        onActivate={activate}
        onSelect={pickOne}
        marked={marked}
        onPick={pick}
        onSweep={swept}
        message={message}
        onVisibleFolders={onVisibleFolders}
      />
      {props.previewVisible && (
        <aside className="browse-preview-slot" aria-label="File preview">
          {props.preview}
        </aside>
      )}
      <div className="browse-status" role="status">
        <span>{props.loading ? 'Loading…' : `${total} ${total === 1 ? 'item' : 'items'}`}</span>
        {many ? (
          <span>
            {markedEntries.length} selected
            {markedEntries.some((entry) => entry.file)
              ? ` · ${formatBytes(markedEntries.reduce((sum, entry) => sum + (entry.file?.size ?? 0), 0))}`
              : ''}
          </span>
        ) : (
          selected && (
            <span>1 selected{selected.file ? ` · ${formatBytes(selected.file.size)}` : ''}</span>
          )
        )}
        {!!props.query.trim() && (
          <BrowseSearchStatus state={props.searchState} onCancel={props.onCancelSearch} />
        )}
      </div>
    </div>
  )
}
