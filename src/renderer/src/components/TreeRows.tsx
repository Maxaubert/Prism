import { useEffect, useRef, useState, type JSX } from 'react'
import type { DirListing, FileKind } from '@shared/types'
import type { TREE_SIZES } from '../lib/treePrefs'
import { useTree } from '../lib/treeContext'

// The rows of the file tree: folders that expand, files that open, and the inline
// rename editor. The panel shell (width, scrolling, loading) lives in Sidebar.

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

type Size = (typeof TREE_SIZES)[number]

/* ---------- glyphs ---------- */

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
      className={`shrink-0 text-[var(--color-dim2,#6b7080)] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
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
function Note({ text, pad }: { text: string; pad: number }): JSX.Element {
  return (
    <div className="py-[5px] text-[11.5px] italic text-[var(--color-dim2,#6b7080)]" style={{ paddingLeft: pad + 20 }}>
      {text}
    </div>
  )
}

/* ---------- rename ---------- */

/** The row turns into this while you rename. The stem is preselected, the way
 *  Explorer does it, so typing replaces the name but keeps the extension. */
function RenameRow({ name, pad, size, onSubmit, onCancel }: {
  name: string
  pad: number
  size: Size
  onSubmit: (v: string) => void
  onCancel: () => void
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(name)
  const done = useRef(false)

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    const dot = name.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : name.length)
  }, [name])

  const finish = (commit: boolean): void => {
    if (done.current) return // blur fires after Enter; only the first one counts
    done.current = true
    if (commit && value.trim() && value !== name) onSubmit(value.trim())
    else onCancel()
  }

  return (
    <div className="flex items-center" style={{ height: size.row, paddingLeft: pad + 19 }}>
      <input
        ref={input}
        value={value}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation() // the app's arrow-key paging must not see this
          if (e.key === 'Enter') finish(true)
          else if (e.key === 'Escape') finish(false)
        }}
        className="w-full rounded border border-[var(--color-accent-hi)] bg-[#0a0c11] px-1.5 py-0.5 text-white outline-none"
        style={{ fontSize: size.font }}
      />
    </div>
  )
}

/* ---------- rows ---------- */

function Folder({ path, name, depth }: { path: string; name: string; depth: number }): JSX.Element {
  const t = useTree()
  const open = t.expanded.has(path)
  const listing = t.children[path]
  const pad = 4 + depth * t.size.indent
  return (
    <li role="none">
      <button
        role="treeitem"
        aria-expanded={open}
        onClick={() => t.onToggle(path)}
        title={name}
        className="flex w-full items-center gap-1.5 rounded-md pr-2 text-left text-[#c4c8d2] transition-colors hover:bg-white/[.06] hover:text-white"
        style={{ height: t.size.row, paddingLeft: pad, fontSize: t.size.font }}
      >
        <Chevron open={open} />
        <FolderIcon color={FOLDER_TINT} />
        <span className="truncate">{name}</span>
      </button>
      {/* Children stay mounted once loaded and the row track collapses to 0fr, so
          opening and closing a folder slides instead of snapping. */}
      {listing ? (
        <div
          className="grid transition-[grid-template-rows] duration-[160ms] [transition-timing-function:cubic-bezier(.23,1,.32,1)]"
          style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <Rows listing={listing} depth={depth + 1} />
          </div>
        </div>
      ) : (
        open && <Note text="loading…" pad={4 + (depth + 1) * t.size.indent} />
      )}
    </li>
  )
}

export function Rows({ listing, depth }: { listing: DirListing; depth: number }): JSX.Element {
  const t = useTree()
  const pad = 4 + depth * t.size.indent
  if (listing.unreadable) return <Note text="can't read this folder" pad={pad} />
  if (!listing.folders.length && !listing.files.length) return <Note text="empty" pad={pad} />
  // A hairline dropped from the parent's chevron, so deep nesting stays legible.
  const guide = depth > 0 ? 4 + (depth - 1) * t.size.indent + 6 : -1
  return (
    <ul role="group" className="relative list-none">
      {guide >= 0 && <span className="absolute inset-y-0 w-px bg-white/[.07]" style={{ left: guide }} aria-hidden />}
      {listing.folders.map((f) => (
        <Folder key={f.path} path={f.path} name={f.name} depth={depth} />
      ))}
      {listing.files.map((f) => {
        if (t.editing === f.path) {
          return (
            <li key={f.path} role="none">
              <RenameRow
                name={f.name}
                pad={pad}
                size={t.size}
                onSubmit={(v) => t.onSubmitRename(f.path, v)}
                onCancel={t.onCancelRename}
              />
            </li>
          )
        }
        const on = !!t.currentPath && f.path.toLowerCase() === t.currentPath.toLowerCase()
        return (
          <li key={f.path} role="none">
            <button
              role="treeitem"
              aria-selected={on}
              onClick={() => t.onOpenFile(f.path)}
              onContextMenu={(e) => t.onMenu(e, f.path, f.name)}
              onKeyDown={(e) => {
                if (e.key === 'F2') {
                  e.preventDefault()
                  t.onStartRename(f.path)
                } else if (e.key === 'Delete') {
                  e.preventDefault()
                  t.onDelete(f.path, f.name)
                }
              }}
              title={f.name}
              className={`flex w-full items-center gap-1.5 rounded-md pr-2 text-left transition-colors ${
                on ? 'bg-[var(--color-accent)] font-medium text-white' : 'text-[#b9bdc8] hover:bg-white/[.06] hover:text-white'
              }`}
              style={{ height: t.size.row, paddingLeft: pad + 19, fontSize: t.size.font }}
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
