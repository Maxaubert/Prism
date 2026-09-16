import { useLayoutEffect, useMemo, useRef, type JSX } from 'react'
import { formatBytes } from '../../lib/format'
import { BrowseIcon } from './BrowseIcon'
import { BrowseList } from './BrowseList'
import { BrowsePlaces } from './BrowsePlaces'
import { BrowseToolbar } from './BrowseToolbar'
import { browseEntries } from './entries'
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
  const entries = useMemo(
    () => browseEntries(props.listing, props.searchState ? '' : props.query, props.sort),
    [props.listing, props.query, props.sort, props.searchState]
  )
  const selected = entries.find((entry) => entry.path === props.selectedPath)
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
        : !entries.length
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
          props.onDelete(selected)
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
        } else if (!typing && inList && selected && e.key === 'F2' && props.onRename) {
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
          else if (selected && key === 'x') props.onCut?.(selected)
          else if (selected) props.onCopy?.(selected)
        }
      }}
    >
      <BrowseToolbar {...props} />
      {props.placesVisible !== false && (
        <BrowsePlaces
          places={props.places}
          onDropInto={props.onDropInto}
          quickAccess={props.quickAccess}
          onQuickAccessFile={props.onQuickAccessFile}
          onUnpinQuickAccess={props.onUnpinQuickAccess}
          onMoveQuickAccess={props.onMoveQuickAccess}
          onPinQuickAccessPaths={props.onPinQuickAccessPaths}
          directory={props.directory}
          onNavigate={props.onNavigate}
          onNewTerminal={props.onNewTerminal}
          onOpenProject={props.onOpenProject}
          onOpenNewTab={props.onOpenNewTab}
        />
      )}
      <div className="browse-actions" aria-label="File actions">
        <button
          disabled={!selected || props.loading}
          onClick={() => {
            if (selected) activate(selected)
          }}
        >
          <BrowseIcon name="open" />
          <span>Open</span>
        </button>
        {props.onOpenProject && (
          <button
            disabled={!selected?.isFolder || props.loading}
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
              if (selected) props.onCopy?.(selected)
            }}
          >
            <BrowseIcon name="copy" />
            <span>Copy</span>
          </button>
        )}
        {props.onRename && (
          <button
            disabled={!selected || props.loading}
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
              if (selected) props.onDelete?.(selected)
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
            disabled={!selected || props.loading}
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
          aria-pressed={props.previewVisible}
          onClick={props.onPreviewToggle}
        >
          <BrowseIcon name="preview" />
        </button>
      </div>
      <BrowseList
        {...props}
        entries={props.loading ? [] : entries}
        onActivate={activate}
        message={message}
      />
      {props.previewVisible && (
        <aside className="browse-preview-slot" aria-label="File preview">
          {props.preview}
        </aside>
      )}
      <div className="browse-status" role="status">
        <span>
          {props.loading
            ? 'Loading…'
            : `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`}
        </span>
        {selected && (
          <span>1 selected{selected.file ? ` · ${formatBytes(selected.file.size)}` : ''}</span>
        )}
      </div>
    </div>
  )
}
