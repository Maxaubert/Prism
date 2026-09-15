import { useCallback, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { browseCrumbs, browseParent } from '../../lib/browse'
import { BrowseIcon } from './BrowseIcon'
import type { FolderBrowserProps } from './types'

type Props = Pick<
  FolderBrowserProps,
  | 'directory'
  | 'canBack'
  | 'canForward'
  | 'query'
  | 'onBack'
  | 'onForward'
  | 'onUp'
  | 'onNavigate'
  | 'onQueryChange'
  | 'onRefresh'
> & {
  /** Display the open file after its containing folder's navigable crumbs. */
  fileName?: string
  /** File viewers return to their containing folder before travelling history. */
  onReturnToFolder?: () => void
  showSearch?: boolean
}

export function BrowseToolbar(props: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [path, setPath] = useState(props.directory)
  const crumbs = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const row = crumbs.current
    if (!row) return
    const reveal = (): void => {
      row.scrollLeft = row.scrollWidth
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(row)
    return () => observer.disconnect()
  }, [props.directory, props.fileName, editing])
  const focusPath = useCallback((el: HTMLInputElement | null): void => {
    el?.focus()
    el?.select()
  }, [])
  const begin = (): void => {
    setPath(props.directory)
    setEditing(true)
  }
  return (
    <div className="browse-toolbar" data-testid="browse-toolbar">
      <div className="browse-history">
        <button
          className="browse-icon-button"
          title={props.onReturnToFolder ? 'Back to folder (Alt+Left)' : 'Back (Alt+Left)'}
          aria-label="Back"
          disabled={!props.onReturnToFolder && !props.canBack}
          onClick={props.onReturnToFolder ?? props.onBack}
        >
          <BrowseIcon name="back" />
        </button>
        <button
          className="browse-icon-button"
          title="Forward (Alt+Right)"
          aria-label="Forward"
          disabled={!props.canForward}
          onClick={props.onForward}
        >
          <BrowseIcon name="forward" />
        </button>
        <button
          className="browse-icon-button"
          title="Up (Alt+Up)"
          aria-label="Up"
          disabled={!props.fileName && !browseParent(props.directory)}
          onClick={props.onUp}
        >
          <BrowseIcon name="up" />
        </button>
        {props.onRefresh && (
          <button
            className="browse-icon-button"
            title="Refresh folder (F5)"
            aria-label="Refresh folder"
            onClick={props.onRefresh}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden
            >
              <path d="M20 7v5h-5M20 12a8 8 0 1 0-2 5M20 7v5" />
            </svg>
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="browse-path-form"
          onSubmit={(e) => {
            e.preventDefault()
            const destination = path.trim().replace(/^"(.*)"$/, '$1')
            if (destination) props.onNavigate(destination)
            setEditing(false)
          }}
        >
          <input
            ref={focusPath}
            name="folderPath"
            value={path}
            aria-label="Folder path"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setPath(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                e.preventDefault()
                setEditing(false)
              }
            }}
          />
        </form>
      ) : (
        <nav
          className="browse-path"
          aria-label="Folder path"
          title={props.directory}
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest('button')) begin()
          }}
        >
          <div className="browse-crumbs" ref={crumbs}>
            {browseCrumbs(props.directory).map((crumb, index, all) => (
              <span className="browse-crumb" key={crumb.path}>
                <button
                  onClick={() => props.onNavigate(crumb.path)}
                  aria-current={
                    !props.fileName && index === all.length - 1 ? 'location' : undefined
                  }
                >
                  {crumb.name}
                </button>
                <BrowseIcon name="chevron" />
              </span>
            ))}
            {props.fileName && (
              <span className="browse-file-crumb" aria-current="page" title={props.fileName}>
                {props.fileName}
              </span>
            )}
          </div>
          <button
            className="browse-edit-path"
            aria-label="Edit folder path"
            title="Edit folder path (Ctrl+L)"
            data-testid="browse-edit-path"
            onClick={begin}
          >
            <BrowseIcon name="rename" />
          </button>
        </nav>
      )}
      {props.showSearch !== false && (
        <label className="browse-search">
          <BrowseIcon name="search" />
          <input
            type="search"
            name="folderSearch"
            spellCheck={false}
            autoComplete="off"
            aria-label="Search this folder and subfolders"
            placeholder="Search folder and subfolders"
            title={
              'Search names in this folder and all subfolders\nWords, "phrases", *.mp4, ext:mp4, -raw'
            }
            value={props.query}
            onChange={(e) => props.onQueryChange(e.target.value)}
          />
        </label>
      )}
    </div>
  )
}
