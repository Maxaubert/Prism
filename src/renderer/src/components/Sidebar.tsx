import { useCallback, useEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import type { DirListing } from '@shared/types'
import { ancestorChain, parentDir, toggleExpanded } from '../lib/fileTree'
import { useAutoScroll, useTreeSide, useTreeSize } from '../lib/treePrefs'
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

/**
 * Bring the open file into view inside the tree, keeping a few rows of context
 * around it.
 *
 * Two behaviours, which is what makes it feel like following rather than
 * snapping: a row that is somewhere on screen is only nudged, and only once it
 * comes within `margin` of an edge - so paging through a folder from the top
 * doesn't move the tree at all until the selection nears the bottom. A row that
 * is off screen entirely (the sidebar was just opened on a file deep in a big
 * folder) is placed near the top, with those few rows above it rather than
 * pinned to the edge.
 */
function revealRow(box: HTMLElement, row: HTMLElement, smooth: boolean): void {
  const height = box.clientHeight
  if (!height) return
  const boxRect = box.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const top = rowRect.top - boxRect.top + box.scrollTop
  const bottom = top + rowRect.height
  // Three rows of context, but never so much that it swallows a short panel.
  const margin = Math.min(Math.max(rowRect.height * 3, 40), height * 0.35)
  const viewTop = box.scrollTop
  const viewBottom = viewTop + height

  let next: number
  if (bottom <= viewTop || top >= viewBottom) next = top - margin
  else if (top < viewTop + margin) next = top - margin
  else if (bottom > viewBottom - margin) next = bottom - height + margin
  else return

  next = Math.max(0, Math.min(next, box.scrollHeight - height))
  if (Math.abs(next - viewTop) < 1) return
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  box.scrollTo({ top: next, behavior: smooth && !still ? 'smooth' : 'auto' })
}

interface Menu {
  x: number
  y: number
  path: string
  name: string
  isFolder: boolean
}

/** Menu glyphs: outlined, so they read as actions rather than as file kinds. */
const MenuIcon = ({ d }: { d: string }): JSX.Element => (
  <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="opacity-80" aria-hidden>
    <path d={d} />
  </svg>
)

export function Sidebar({
  open,
  root,
  currentPath,
  refreshKey,
  onOpenFile,
  onRename,
  onDelete,
  wash
}: {
  open: boolean
  root: string
  currentPath: string | null
  /** Bumped by App after a rename or delete, to re-read the folders on screen. */
  refreshKey: number
  onOpenFile: (path: string) => void
  onRename: (path: string, name: string) => void
  onDelete: (path: string, name: string, isFolder: boolean) => void
  /** Whether the style's light reaches the panel. Follows the window. */
  wash: boolean
}): JSX.Element {
  const [state, setState] = useState<TreeState>({ expanded: new Set([root]), children: {} })
  const [revealed, setRevealed] = useState<string | null>(null)
  const [width, setWidth] = useState(loadWidth)
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const panel = useRef<HTMLElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // The file the tree has already been positioned for. Scrolling away by hand
  // doesn't clear it, so collapsing and reopening leaves the tree where you put
  // it; only a new file asks to be found again.
  const placed = useRef<string | null>(null)
  const size = useTreeSize()
  const autoScroll = useAutoScroll()
  // On the right, everything that faces the media flips: the edge it draws, the
  // handle you grab, and which way dragging makes it wider.
  const side = useTreeSide()
  const right = side === 'right'

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

  // Follow the open file. While the panel is shut nothing moves, so the scroll
  // it wakes up with is the one it went to sleep with; the reveal then happens
  // on the way open, for a file it hasn't been positioned for yet.
  useEffect(() => {
    if (!autoScroll || !open || !currentPath) return
    if (placed.current === currentPath) return
    const box = scroller.current
    if (!box) return
    // The row may not exist yet: its folder can still be loading.
    let frame = 0
    let tries = 0
    const attempt = (): void => {
      const row = box.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]')
      if (!row) {
        if (tries++ < 40) frame = requestAnimationFrame(attempt)
        return
      }
      const first = placed.current === null
      placed.current = currentPath
      revealRow(box, row, !first)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [autoScroll, open, currentPath, state.children])

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
      const box = panel.current.getBoundingClientRect()
      resize(right ? box.right - e.clientX : e.clientX - box.left)
    },
    [dragging, resize, right]
  )

  const onHandleUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }, [])

  const onHandleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const wider = right ? 'ArrowLeft' : 'ArrowRight'
      if (e.key === wider) resize(width + 16)
      else if (e.key === (right ? 'ArrowRight' : 'ArrowLeft')) resize(width - 16)
      else return
      e.preventDefault()
    },
    [resize, width, right]
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
      className={`relative h-full shrink-0 overflow-hidden bg-[var(--p-side)] ${wash ? 'p-wash ' : ''}${
        dragging ? '' : 'transition-[width] duration-[180ms] [transition-timing-function:cubic-bezier(.23,1,.32,1)]'
      }`}
    >
      <div
        className={`flex h-full flex-col ${right ? 'border-l' : 'border-r'} border-[var(--p-divider)]`}
        style={{ width }}
      >
        <div className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-[.12em] text-[var(--p-dim)]">
          <span className="truncate" title={root}>
            {rootName}
          </span>
        </div>
        {/* No scrollbar: the tree scrolls, it just doesn't advertise it. */}
        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
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
              <div className="py-[5px] pl-6 text-[11.5px] italic text-[var(--p-dim2)]">loading…</div>
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
        className={`no-drag group absolute inset-y-0 z-10 w-2 cursor-col-resize focus-visible:outline-none ${
          right ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'
        }`}
      >
        <span
          className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150 group-hover:bg-[var(--p-accent-hi)] group-focus-visible:bg-[var(--p-accent-hi)] ${
            dragging ? 'bg-[var(--p-accent-hi)]' : 'bg-transparent'
          }`}
        />
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename', hint: 'F2', icon: <MenuIcon d="M4 20h4L19 9l-4-4L4 16z" />, onPick: () => setEditing(menu.path) },
            {
              label: 'Delete',
              hint: 'Del',
              danger: true,
              icon: <MenuIcon d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />,
              onPick: () => onDelete(menu.path, menu.name, menu.isFolder)
            }
          ]}
        />
      )}
    </aside>
  )
}
