import { useCallback, useEffect, useState, type JSX } from 'react'
import type { DirListing, FileKind } from '@shared/types'
import { ancestorChain, parentDir, toggleExpanded } from '../lib/fileTree'

// The folder tree, rooted at the folder Prism was opened in. Children load the
// first time a folder is opened and are cached after that; main refuses anything
// outside the root, so there is no way up and no ".." row.

const ROW = 'flex w-full items-center gap-1.5 rounded-md py-[5px] pr-2 text-left text-[12.5px] transition-colors'
const INDENT = 13 // px per depth, matched to the chevron column

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

/** A quiet glyph per kind, so the eye can sort a long list without reading it. */
function KindIcon({ kind }: { kind: FileKind }): JSX.Element {
  const d: Record<FileKind, string> = {
    image: 'M4 5h16v14H4zM4 15l4.5-4.5L13 15l3-3 4 4',
    video: 'M4 6h16v12H4zM10 9.5l5 2.5-5 2.5z',
    audio: 'M9 17V6l10-2v11M9 17a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
    pdf: 'M6 3h8l4 4v14H6zM14 3v4h4',
    text: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 16.5h6',
    other: 'M6 3h8l4 4v14H6zM14 3v4h4'
  }
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className="shrink-0" aria-hidden>
      <path d={d[kind]} />
    </svg>
  )
}

function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className="shrink-0" aria-hidden>
      <path d="M3 6h6l2 2.5h10V19H3z" />
    </svg>
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
        <span className="text-[var(--color-dim)]"><FolderIcon /></span>
        <span className="truncate">{name}</span>
      </button>
      {open &&
        (listing ? (
          <Rows listing={listing} depth={depth + 1} state={state} onToggle={onToggle} onOpenFile={onOpenFile} currentPath={currentPath} />
        ) : (
          <Note text="loading…" depth={depth + 1} />
        ))}
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
  return (
    <ul role="group" className="list-none">
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
                  ? 'bg-[var(--color-accent)]/25 font-medium text-white'
                  : 'text-[#b9bdc8] hover:bg-white/[.06] hover:text-white'
              }`}
              style={{ paddingLeft: 4 + depth * INDENT + 13 + 6 }}
            >
              <span className={on ? 'text-[var(--color-accent-hi)]' : 'text-[var(--color-dim)]'}>
                <KindIcon kind={f.kind} />
              </span>
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
  root,
  currentPath,
  onOpenFile
}: {
  root: string
  currentPath: string | null
  onOpenFile: (p: string) => void
}): JSX.Element {
  const [state, setState] = useState<TreeState>({ expanded: new Set([root]), children: {} })
  const [revealed, setRevealed] = useState<string | null>(null)

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
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-white/[.06] bg-[#0e1016]">
      <div className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-[.12em] text-[var(--color-dim)]">
        <span className="truncate" title={root}>
          {rootName}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {rootListing ? (
          <ul role="tree" aria-label="Folder contents" className="list-none">
            <Rows listing={rootListing} depth={0} state={state} onToggle={toggle} onOpenFile={onOpenFile} currentPath={currentPath} />
          </ul>
        ) : (
          <Note text="loading…" depth={0} />
        )}
      </div>
    </aside>
  )
}
