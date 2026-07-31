import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { DirListing, FileKind } from '@shared/types'
import { ancestorChain, parentDir, toggleExpanded } from '../lib/fileTree'

// The folder tree, rooted at the folder Prism was opened in. Children load the
// first time a folder is opened and are cached after that; main refuses anything
// outside the root, so there is no way up and no ".." row.

const ROW = 'flex h-[26px] w-full items-center gap-1.5 rounded-md pr-2 text-left text-[12.5px] transition-colors'
const INDENT = 13 // px per depth, matched to the chevron column
const PANEL = '#0e1016' // the panel colour, used to knock detail out of filled glyphs

// A muted colour per kind, so a long list sorts itself by eye before you read a
// single name. Low saturation on purpose: the media is the star, not the tree.
const TINT: Record<FileKind, string> = {
  image: '#6fb2a8',
  video: '#8f8ae0',
  audio: '#d3a06a',
  pdf: '#cf7f88',
  text: '#8d93a1',
  other: '#8d93a1'
}
const FOLDER_TINT = '#9aa0f0'

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

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function Glyph({ children, color }: { children: JSX.Element; color: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill={color} className="shrink-0" aria-hidden>
      {children}
    </svg>
  )
}

/** Filled glyph per kind. Detail is knocked out in the panel colour rather than
 *  drawn as strokes, so the shape still reads as a photo or a page at 14px. */
function KindIcon({ kind, color }: { kind: FileKind; color: string }): JSX.Element {
  const ko = { fill: PANEL, fillOpacity: 0.85 }
  switch (kind) {
    case 'image':
      return (
        <Glyph color={color}>
          <>
            <path d="M3.5 5h17v14h-17z" />
            <path d="M6 16.2l3.6-4.2 2.6 3 2.3-2.4 3.5 3.6z" {...ko} />
            <circle cx="8.4" cy="9.2" r="1.7" {...ko} />
          </>
        </Glyph>
      )
    case 'video':
      return (
        <Glyph color={color}>
          <>
            <path d="M3.5 5h17v14h-17z" />
            <path d="M10 9.2l5.6 2.8L10 14.8z" {...ko} />
          </>
        </Glyph>
      )
    case 'audio':
      return (
        <Glyph color={color}>
          <path d="M9 16.4V6l10-2v10.4a2.6 2.6 0 1 1-1.6-2.4V6.6L10.6 8.2v8.2A2.6 2.6 0 1 1 9 14z" />
        </Glyph>
      )
    case 'pdf':
      return (
        <Glyph color={color}>
          <>
            <path d="M6 2.5h7.5L19 8v13.5H6z" />
            <path d="M13 2.5V8h5.4z" fillOpacity={0.55} />
            <path d="M8.6 15.5h6.8v3.2H8.6z" {...ko} />
          </>
        </Glyph>
      )
    default:
      return (
        <Glyph color={color}>
          <>
            <path d="M6 2.5h7.5L19 8v13.5H6z" />
            <path d="M13 2.5V8h5.4z" fillOpacity={0.55} />
            <path d="M8.6 12h7.8v1.3H8.6zM8.6 15.2h7.8v1.3H8.6zM8.6 18.4h5v1.3h-5z" {...ko} />
          </>
        </Glyph>
      )
  }
}

function FolderIcon({ color }: { color: string }): JSX.Element {
  return (
    <Glyph color={color}>
      <path d="M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z" />
    </Glyph>
  )
}

/** A muted, unclickable row: "empty", "can't read", "loading". */
function Note({ text, depth }: { text: string; depth: number }): JSX.Element {
  return (
    <div className="py-[5px] text-[11.5px] italic text-[var(--color-dim2,#6b7080)]" style={{ paddingLeft: 8 + depth * INDENT + 16 }}>
      {text}
    </div>
  )
}

function Folder({
  path,
  name,
  depth,
  state,
  onToggle,
  onOpenFile,
  currentPath
}: {
  path: string
  name: string
  depth: number
  state: TreeState
  onToggle: (p: string) => void
  onOpenFile: (p: string) => void
  currentPath: string | null
}): JSX.Element {
  const open = state.expanded.has(path)
  const listing = state.children[path]
  return (
    <li role="none">
      <button
        role="treeitem"
        aria-expanded={open}
        onClick={() => onToggle(path)}
        title={name}
        className={`${ROW} text-[#c4c8d2] hover:bg-white/[.06] hover:text-white`}
        style={{ paddingLeft: 4 + depth * INDENT }}
      >
        <Chevron open={open} />
        <FolderIcon color={FOLDER_TINT} />
        <span className="truncate">{name}</span>
      </button>
      {/* Children stay mounted once loaded and the row track collapses to 0fr, so
          opening and closing a folder slides instead of snapping. */}
      {listing ? (
        <div
          className="grid transition-[grid-template-rows] duration-[160ms] ease-out [transition-timing-function:cubic-bezier(.23,1,.32,1)]"
          style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <Rows listing={listing} depth={depth + 1} state={state} onToggle={onToggle} onOpenFile={onOpenFile} currentPath={currentPath} />
          </div>
        </div>
      ) : (
        open && <Note text="loading…" depth={depth + 1} />
      )}
    </li>
  )
}

function Rows({
  listing,
  depth,
  state,
  onToggle,
  onOpenFile,
  currentPath
}: {
  listing: DirListing
  depth: number
  state: TreeState
  onToggle: (p: string) => void
  onOpenFile: (p: string) => void
  currentPath: string | null
}): JSX.Element {
  if (listing.unreadable) return <Note text="can't read this folder" depth={depth} />
  if (!listing.folders.length && !listing.files.length) return <Note text="empty" depth={depth} />
  // A hairline dropped from the parent's chevron, so deep nesting stays legible.
  const guide = depth > 0 ? 4 + (depth - 1) * INDENT + 6 : -1
  return (
    <ul role="group" className="relative list-none">
      {guide >= 0 && <span className="absolute inset-y-0 w-px bg-white/[.07]" style={{ left: guide }} aria-hidden />}
      {listing.folders.map((f) => (
        <Folder key={f.path} path={f.path} name={f.name} depth={depth} state={state} onToggle={onToggle} onOpenFile={onOpenFile} currentPath={currentPath} />
      ))}
      {listing.files.map((f) => {
        const on = !!currentPath && f.path.toLowerCase() === currentPath.toLowerCase()
        return (
          <li key={f.path} role="none">
            <button
              role="treeitem"
              aria-selected={on}
              onClick={() => onOpenFile(f.path)}
              title={f.name}
              className={`${ROW} ${
                on
                  ? 'bg-[var(--color-accent)] font-medium text-white'
                  : 'text-[#b9bdc8] hover:bg-white/[.06] hover:text-white'
              }`}
              style={{ paddingLeft: 4 + depth * INDENT + 13 + 6 }}
            >
              <KindIcon kind={f.kind} color={on ? '#ffffff' : TINT[f.kind]} />
              <span className="truncate">{f.name}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

interface TreeState {
  expanded: Set<string>
  /** path -> its children, once loaded. Absent means "not loaded yet". */
  children: Record<string, DirListing>
}

export function Sidebar({
  open,
  root,
  currentPath,
  onOpenFile
}: {
  open: boolean
  root: string
  currentPath: string | null
  onOpenFile: (p: string) => void
}): JSX.Element {
  const [state, setState] = useState<TreeState>({ expanded: new Set([root]), children: {} })
  const [revealed, setRevealed] = useState<string | null>(null)
  const [width, setWidth] = useState(loadWidth)
  // While dragging, the panel must track the pointer exactly: any transition
  // would make the edge lag behind the cursor.
  const [dragging, setDragging] = useState(false)
  const panel = useRef<HTMLElement>(null)

  const resize = useCallback((next: number) => {
    const w = clampWidth(next)
    setWidth(w)
    localStorage.setItem(WIDTH_KEY, String(w))
  }, [])

  const onHandleDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
    },
    []
  )

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

  // Arrow keys move the edge too, so the panel isn't mouse-only.
  const onHandleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') resize(width - 16)
      else if (e.key === 'ArrowRight') resize(width + 16)
      else return
      e.preventDefault()
    },
    [resize, width]
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

  /** Load a folder's children once, then keep them. A refusal (outside the root)
   *  is cached as unreadable so the row says so instead of spinning forever. */
  const load = useCallback(async (p: string): Promise<void> => {
    const listing = (await window.prism.listDir(p)) ?? { folders: [], files: [], unreadable: true }
    setState((s) => (s.children[p] ? s : { ...s, children: { ...s.children, [p]: listing } }))
  }, [])

  const toggle = useCallback(
    (p: string) => {
      setState((s) => ({ ...s, expanded: toggleExpanded(s.expanded, p) }))
      void load(p)
    },
    [load]
  )

  // Fetch what the reveal just opened (the root included, on first paint).
  useEffect(() => {
    const chain = currentPath ? ancestorChain(root, currentPath) : []
    ;[root, ...chain].forEach((p) => void load(p))
  }, [root, currentPath, load])

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
          {rootListing ? (
            <ul role="tree" aria-label="Folder contents" className="list-none">
              <Rows listing={rootListing} depth={0} state={state} onToggle={toggle} onOpenFile={onOpenFile} currentPath={currentPath} />
            </ul>
          ) : (
            <Note text="loading…" depth={0} />
          )}
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
    </aside>
  )
}
