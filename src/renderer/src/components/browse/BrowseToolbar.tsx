import { useCallback, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { browseCrumbs, browseParent } from '../../lib/browse'
import { clipboardText } from '../../lib/clipboardText'
import { ContextMenu } from '../ContextMenu'
import { BrowseIcon } from './BrowseIcon'
import type { FolderBrowserProps } from './types'
import { useFolderDrop } from './useFolderDrop'
import { KindIcon } from '../TreeRows'
import { browsableArchive } from '@shared/archivePlace'
import './archive.css'

const crumbKey = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

type Props = Pick<
  FolderBrowserProps,
  | 'directory'
  | 'canBack'
  | 'canForward'
  | 'onBack'
  | 'onForward'
  | 'onUp'
  | 'onNavigate'
  | 'onRefresh'
  | 'onDropInto'
> & {
  /** Display the open file after its containing folder's navigable crumbs. */
  fileName?: string
  /** File viewers return to their containing folder before travelling history. */
  onReturnToFolder?: () => void
  /** What sits after the address field: the Explorer's preview toggle and
   *  search button (#267). The file viewer's toolbar has none. */
  trailing?: ReactNode
  /** The archives along the path (#300, `ArchiveMeta.chain`): those crumbs
   *  wear the archive icon. Before main has answered, a crumb named like an
   *  archive with more path after it is taken to be one. */
  archiveChain?: string[]
}

export function BrowseToolbar(props: Props): JSX.Element {
  const folderDrop = useFolderDrop(props.onDropInto)
  const [editing, setEditing] = useState(false)
  /** The address bar's right-click menu (owner, 2026-09-22: "let me right
   *  click the url bar to get options to copy path or copy as text, like File
   *  Explorer"), at the pointer, for one folder: the crumb right-clicked, or
   *  the folder shown when it was the bar itself. */
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [path, setPath] = useState(props.directory)
  const crumbs = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const row = crumbs.current
    if (!row) return
    // A long path keeps its END in view, the folder you are in, and the
    // field fades its start so the cut reads as a cut rather than a name.
    const reveal = (): void => {
      row.scrollLeft = row.scrollWidth
      if (row.scrollLeft > 0) row.dataset.clipped = ''
      else delete row.dataset.clipped
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(row)
    return () => observer.disconnect()
  }, [props.directory, props.fileName, editing, props.archiveChain?.length])
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
          className="browse-path browse-field"
          aria-label="Folder path"
          title={props.directory}
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest('button')) begin()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const crumb = (event.target as HTMLElement).closest<HTMLElement>('[data-crumb-path]')
            setMenu({ x: event.clientX, y: event.clientY, path: crumb?.dataset.crumbPath ?? props.directory })
          }}
        >
          <div className="browse-crumbs" ref={crumbs}>
            {browseCrumbs(props.directory).map((crumb, index, all) => (
              // DOLPHIN'S ADDRESS FIELD (#267; owner, 2026-10-04: "the url bar
              // in the image looks really clean too so copy that style"): a
              // chevron LEADS every name, the first one included, so the row
              // reads "> C: > Users > Admin" with the folder you are in bold.
              <span className="browse-crumb" key={crumb.path}>
                <BrowseIcon name="chevron" />
                <button
                  {...folderDrop(crumb.path)}
                  data-crumb-path={crumb.path}
                  onClick={() => props.onNavigate(crumb.path)}
                  aria-current={
                    !props.fileName && index === all.length - 1 ? 'location' : undefined
                  }
                  data-crumb-archive={
                    (props.archiveChain
                      ? props.archiveChain.some((c) => crumbKey(c) === crumbKey(crumb.path))
                      : browsableArchive(crumb.name) && (index < all.length - 1 || !!props.fileName)) ||
                    undefined
                  }
                >
                  {(props.archiveChain
                    ? props.archiveChain.some((c) => crumbKey(c) === crumbKey(crumb.path))
                    : browsableArchive(crumb.name) && (index < all.length - 1 || !!props.fileName)) && (
                    <KindIcon
                      kind="archive"
                      ext={/\.[^.]*$/.exec(crumb.name)?.[0]}
                      name={crumb.name}
                      color="var(--p-tree-zip)"
                      size={14}
                      bg="var(--p-control)"
                    />
                  )}
                  {crumb.name}
                </button>
              </span>
            ))}
            {props.fileName && (
              <span className="browse-crumb">
                <BrowseIcon name="chevron" />
                <span className="browse-file-crumb" aria-current="page" title={props.fileName}>
                  {props.fileName}
                </span>
              </span>
            )}
          </div>
          <button
            className="browse-edit-path"
            aria-label="Edit folder path"
            title="Edit folder path (Ctrl+L)"
            data-testid="browse-edit-path"
            onClick={begin}
          />
        </nav>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            // Explorer's own words and pair: the folder itself (a paste in
            // Explorer takes the folder, a paste in text takes the path), and
            // the path as plain text.
            { label: 'Copy address', onPick: () => void window.prism.copyAddress(menu.path) },
            { label: 'Copy address as text', onPick: () => void clipboardText(menu.path) },
            { label: 'Edit address', hint: 'Ctrl+L', onPick: begin }
          ]}
        />
      )}
      {props.trailing}
    </div>
  )
}
