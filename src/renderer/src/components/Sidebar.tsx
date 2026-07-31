import { useCallback, useEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import type { DirListing } from '@shared/types'
import { ancestorChain, parentDir, toggleExpanded } from '../lib/fileTree'
import { useTreeSize } from '../lib/treePrefs'
import { ContextMenu } from './ContextMenu'
import { Rows } from './TreeRows'
import { TreeProvider } from '../lib/treeContext'

// The folder tree, rooted at the folder Prism was opened in. Children load the
// first time a folder is opened and are cached after that; main refuses anything
// outside the root, so there is no way up and no ".." row.

// Panel width: dragged from the edge, remembered, and bounded so it can't be
// squeezed into uselessness or grow to swallow the media.
const WIDTH_KEY = 'prism.sidebar.width'
const MIN_W = 170
const MAX_W = 520
const DEFAULT_W = 260

const clampWidth = (n: number): number => Math.round(Math.min(MAX_W, Math.max(MIN_W, n)))

function loadWidth(): number {
  const v = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(v) && v > 0 ? clampWidth(v) : DEFAULT_W
}

interface TreeState {
  expanded: Set<string>
  /** path -> its children, once loaded. Absent means "not loaded yet". */
  children: Record<string, DirListing>
}

interface Menu {
  x: number
  y: number
  path: string
  name: string
  isFolder: boolean
}

export function Sidebar({
  open,
  root,
  currentPath,
  refreshKey,
  onOpenFile,
  onRename,
  onDelete
}: {
  open: boolean
  root: string
  currentPath: string | null
  /** Bumped by App after a rename or delete, to re-read the folders on screen. */
  refreshKey: number
  onOpenFile: (path: string) => void
  onRename: (path: string, name: string) => void
  onDelete: (path: string, name: string, isFolder: boolean) => void
}): JSX.Element {
  const [state, setState] = useState<TreeState>({ expanded: new Set([root]), children: {} })
  const [revealed, setRevealed] = useState<string | null>(null)
  const [width, setWidth] = useState(loadWidth)
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const panel = useRef<HTMLElement>(null)
  const size = useTreeSize()

  /* ---------- loading ---------- */

  /** Load a folder's children once, then keep them. A refusal (outside the root)
   *  is cached as unreadable so the row says so instead of spinning forever. */
  const load = useCallback(async (p: string, force = false): Promise<void> => {
    const listing = (await window.prism.listDir(p)) ?? { folders: [], files: [], unreadable: true }
    setState((s) => (s.children[p] && !force ? s : { ...s, children: { ...s.children, [p]: listing } }))
  }, [])

  const toggle = useCallback(
    (p: string) => {
      setState((s) => ({ ...s, expanded: toggleExpanded(s.expanded, p) }))
      void load(p)
    },
    [load]
  )

  // Reveal: when the open file changes, expand every folder between the root and
  // it. Adjusting state during render (rather than in an effect) keeps a folder
  // the user collapsed collapsed until the file actually moves.
  if (currentPath !== revealed) {
    setRevealed(currentPath)
    const chain = currentPath ? ancestorChain(root, currentPath) : [root]
    if (chain.length) {
      setState((s) => {
        const expanded = new Set(s.expanded)
        chain.forEach((p) => expanded.add(p))
        return { ...s, expanded }
      })
    }
  }

  // Fetch what the reveal just opened (the root included, on first paint).
  useEffect(() => {
    const chain = currentPath ? ancestorChain(root, currentPath) : []
    ;[root, ...chain].forEach((p) => void load(p))
  }, [root, currentPath, load])

  // A file changed on disk: re-read every folder we're showing, so the row that
  // was renamed or removed matches reality.
  useEffect(() => {
    if (!refreshKey) return
    Object.keys(state.children).forEach((p) => void load(p, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the bump alone; re-running per cache change would loop
  }, [refreshKey])

  /* ---------- resizing ---------- */

  const resize = useCallback((next: number) => {
    const w = clampWidth(next)
    setWidth(w)
    localStorage.setItem(WIDTH_KEY, String(w))
  }, [])

  const onHandleDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }, [])

  const onHandleMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || !panel.current) return
      resize(e.clientX - panel.current.getBoundingClientRect().left)
    },
    [dragging, resize]
  )

  const onHandleUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }, [])

  const onHandleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') resize(width - 16)
      else if (e.key === 'ArrowRight') resize(width + 16)
      else return
      e.preventDefault()
    },
    [resize, width]
  )

  /* ---------- row actions ---------- */

  const onMenu = useCallback((e: MouseEvent, path: string, name: string, isFolder: boolean) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, path, name, isFolder })
  }, [])

  const submitRename = useCallback(
    (path: string, name: string) => {
      setEditing(null)
      onRename(path, name)
    },
    [onRename]
  )

  const rootListing = state.children[root]
  const rootName = root.slice(parentDir(root).length).replace(/^[\\/]/, '') || root

  return (
    // The panel stays mounted and collapses to zero width, so opening and closing
    // slides. Its contents keep the full width throughout (the outer box just
    // clips), which keeps the rows from reflowing on every frame of the slide.
    <aside
      ref={panel}
      inert={!open}
      aria-hidden={!open}
      style={{ width: open ? width : 0 }}
      className={`relative h-full shrink-0 overflow-hidden bg-[#0e1016] ${
        dragging ? '' : 'transition-[width] duration-[180ms] [transition-timing-function:cubic-bezier(.23,1,.32,1)]'
      }`}
    >
      <div className="flex h-full flex-col border-r border-white/[.06]" style={{ width }}>
        <div className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-[.12em] text-[var(--color-dim)]">
          <span className="truncate" title={root}>
            {rootName}
          </span>
        </div>
        {/* No scrollbar: the tree scrolls, it just doesn't advertise it. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TreeProvider
            value={{
              expanded: state.expanded,
              children: state.children,
              currentPath,
              size,
              editing,
              onToggle: toggle,
              onOpenFile,
              onStartRename: setEditing,
              onSubmitRename: submitRename,
              onCancelRename: () => setEditing(null),
              onDelete,
              onMenu
            }}
          >
            {rootListing ? (
              <ul role="tree" aria-label="Folder contents" className="list-none">
                <Rows listing={rootListing} depth={0} />
              </ul>
            ) : (
              <div className="py-[5px] pl-6 text-[11.5px] italic text-[var(--color-dim2,#6b7080)]">loading…</div>
            )}
          </TreeProvider>
        </div>
      </div>

      {/* Drag the edge to resize; double-click snaps back to the default. The hit
          area is wider than the line it draws, so it's grabbable without hunting. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file tree"
        aria-valuenow={width}
        aria-valuemin={MIN_W}
        aria-valuemax={MAX_W}
        tabIndex={open ? 0 : -1}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        onDoubleClick={() => resize(DEFAULT_W)}
        onKeyDown={onHandleKey}
        className="no-drag group absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize focus-visible:outline-none"
      >
        <span
          className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150 group-hover:bg-[var(--color-accent-hi)] group-focus-visible:bg-[var(--color-accent-hi)] ${
            dragging ? 'bg-[var(--color-accent-hi)]' : 'bg-transparent'
          }`}
        />
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.name}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename', hint: 'F2', onPick: () => setEditing(menu.path) },
            { label: 'Delete', hint: 'Del', danger: true, onPick: () => onDelete(menu.path, menu.name, menu.isFolder) }
          ]}
        />
      )}
    </aside>
  )
}
