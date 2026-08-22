import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { FileKind, ViewerFile } from '@shared/types'
import { formatBytes } from '../lib/format'
import { loadTransportStyle } from '../lib/transport'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Dialog } from './Dialog'
import { ImageView } from './ImageView'
import { MarkdownView } from './MarkdownView'
import { PdfView } from './pdf/PdfView'
import { VideoView } from './VideoView'
import { AudioView } from './AudioView'

const CodeView = lazy(() => import('./CodeView').then((m) => ({ default: m.CodeView })))

// The inside of a zip (#68): a quick look, not WinRAR. A tree of the
// archive's members with four verbs - view (extract to temp and show with the
// ordinary viewers), copy (the real clipboard), rename, delete. Deleting is
// the one destructive act Prism allows here, because a zip has no recycle
// bin; it confirms first and says exactly that.

type Entry = { path: string; name: string; dir: boolean; size: number }
type Row = Entry & { depth: number }

const isMarkdown = (name: string): boolean => /\.(md|markdown)$/i.test(name)

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={11}
      height={11}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 opacity-70 transition-transform ${open ? 'rotate-90' : ''}`}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

/** The extracted member, shown with the same viewers the folder uses. */
function MemberView({ name, path, kind }: { name: string; path: string; kind: FileKind }): JSX.Element {
  const url = window.prism.mediaUrl(path)
  const noop = useCallback(() => {}, [])
  switch (kind) {
    case 'image':
      return <ImageView url={url} name={name} onToggleFullscreen={noop} />
    case 'video':
      return <VideoView url={url} path={path} onToggleFullscreen={noop} onAutoAdvance={noop} transportStyle={loadTransportStyle()} />
    case 'audio':
      return <AudioView url={url} name={name} fullscreen={false} onToggleFullscreen={noop} onAutoAdvance={noop} transportStyle={loadTransportStyle()} />
    case 'pdf':
      return <PdfView url={url} onToggleFullscreen={noop} />
    case 'text':
      return isMarkdown(name) ? (
        <MarkdownView path={path} onOpenLocal={noop} />
      ) : (
        <Suspense fallback={null}>
          <CodeView path={path} name={name} onSaved={noop} onBuffer={noop} getPending={() => undefined} />
        </Suspense>
      )
    default:
      return (
        <div className="grid h-full place-items-center text-[13px] text-[var(--p-dim)]">
          No viewer for this file type
        </div>
      )
  }
}

/** Keyed by path, so switching zip to zip starts the inner state fresh
 *  instead of resetting it imperatively in an effect. */
export function ArchiveView({ file }: { file: ViewerFile }): JSX.Element {
  return <ArchiveInner key={file.path} file={file} />
}

function ArchiveInner({ file }: { file: ViewerFile }): JSX.Element {
  const [entries, setEntries] = useState<Entry[] | null | 'error'>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [member, setMember] = useState<{ name: string; path: string; kind: FileKind } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<Entry | null>(null)
  const [oops, setOops] = useState<string | null>(null)

  const load = useCallback(() => {
    void window.prism.archiveList(file.path).then((list) => setEntries(list ?? 'error'))
  }, [file.path])
  useEffect(() => load(), [load])

  // The visible rows: children per folder, folders first, walked through the
  // expanded set. Same shape as the sidebar's tree, scoped to the archive.
  const rows = useMemo((): Row[] => {
    if (!entries || entries === 'error') return []
    const kids = new Map<string, Entry[]>()
    for (const e of entries) {
      const parent = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : ''
      if (!kids.has(parent)) kids.set(parent, [])
      kids.get(parent)!.push(e)
    }
    for (const list of kids.values())
      list.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    const out: Row[] = []
    const walk = (parent: string, depth: number): void => {
      for (const e of kids.get(parent) ?? []) {
        out.push({ ...e, depth })
        if (e.dir && expanded.has(e.path)) walk(e.path, depth + 1)
      }
    }
    walk('', 0)
    return out
  }, [entries, expanded])

  const toggle = (path: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const view = useCallback(
    (entry: Entry): void => {
      void window.prism.archiveExtract(file.path, entry.path).then((r) => {
        if (r) setMember({ name: entry.name, path: r.path, kind: r.kind })
        else setOops(`Couldn't open "${entry.name}" from the archive.`)
      })
    },
    [file.path]
  )
  const copyOut = useCallback(
    (entry: Entry): void => {
      void window.prism.archiveExtract(file.path, entry.path).then((r) => {
        if (r) void window.prism.copyFileToClipboard(r.path)
        else setOops(`Couldn't copy "${entry.name}" out of the archive.`)
      })
    },
    [file.path]
  )
  const submitRename = useCallback(
    (entry: Entry, name: string): void => {
      setEditing(null)
      if (!name || name === entry.name) return
      void window.prism.archiveRename(file.path, entry.path, name).then((ok) => {
        if (ok) load()
        else setOops(`Couldn't rename to "${name}". The name may be taken or invalid.`)
      })
    },
    [file.path, load]
  )
  const doDelete = useCallback(
    (entry: Entry): void => {
      setConfirmDel(null)
      void window.prism.archiveDelete(file.path, entry.path).then((ok) => {
        if (ok) load()
        else setOops(`Couldn't delete "${entry.name}".`)
      })
    },
    [file.path, load]
  )

  // Escape closes the member preview (data-owns-escape keeps the window's own
  // Escape out of it while the preview is up).
  useEffect(() => {
    if (!member) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setMember(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [member])

  const menuItems = (entry: Entry): MenuItem[] => [
    { label: 'View', onPick: () => view(entry) },
    { label: 'Copy file', onPick: () => copyOut(entry) },
    { label: 'Rename', hint: 'F2', onPick: () => setEditing(entry.path) },
    { label: 'Delete from archive', danger: true, onPick: () => setConfirmDel(entry) }
  ]

  if (entries === 'error')
    return (
      <div className="grid h-full place-items-center text-[13px] text-[var(--p-dim)]">
        Can&apos;t read this archive
      </div>
    )

  return (
    <div className="relative h-full w-full">
      <div className="h-full overflow-y-auto px-4 py-3">
        {entries === null ? (
          <div className="py-2 text-[12px] italic text-[var(--p-dim2)]">loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-2 text-[12px] italic text-[var(--p-dim2)]">empty archive</div>
        ) : (
          <ul role="tree" aria-label={`Contents of ${file.name}`} className="mx-auto max-w-[760px] list-none">
            {rows.map((r) =>
              editing === r.path ? (
                <li key={r.path} style={{ paddingLeft: 8 + r.depth * 16 }}>
                  <RenameInput name={r.name} onSubmit={(v) => submitRename(r, v)} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li key={r.path} role="none">
                  <button
                    role="treeitem"
                    aria-expanded={r.dir ? expanded.has(r.path) : undefined}
                    className="flex h-[26px] w-full items-center gap-1.5 rounded-[var(--p-radius-sm)] pr-2 text-left text-[12.5px] text-[var(--p-text-soft)] outline-none transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] focus-visible:bg-[var(--p-hover)]"
                    style={{ paddingLeft: 8 + r.depth * 16 }}
                    onClick={() => (r.dir ? toggle(r.path) : view(r))}
                    onContextMenu={(e) => {
                      if (r.dir) return
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, entry: r })
                    }}
                    onKeyDown={(e) => {
                      if (r.dir) return
                      if (e.key === 'F2') {
                        e.preventDefault()
                        setEditing(r.path)
                      } else if (e.key === 'Delete') {
                        e.preventDefault()
                        setConfirmDel(r)
                      }
                    }}
                  >
                    {r.dir ? (
                      <>
                        <Chevron open={expanded.has(r.path)} />
                        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="var(--p-tree-folder)" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
                          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        </svg>
                      </>
                    ) : (
                      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="var(--p-tree-file)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="ml-[17px] shrink-0" aria-hidden>
                        <path d="M6 3h8l4 4v14H6z M14 3v4h4" />
                      </svg>
                    )}
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    {!r.dir && <span className="shrink-0 text-[11px] text-[var(--p-dim2)]">{formatBytes(r.size)}</span>}
                  </button>
                </li>
              )
            )}
          </ul>
        )}
      </div>

      {member && (
        <div data-owns-escape className="absolute inset-0 z-20 flex flex-col bg-[var(--p-bg)]">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--p-divider)] px-2 text-[12.5px]">
            <button
              className="no-drag grid h-6 w-7 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
              onClick={() => setMember(null)}
              title="Back to the archive (Esc)"
              aria-label="Back to the archive"
            >
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <span className="min-w-0 truncate text-[var(--p-text)]">{member.name}</span>
            <span className="min-w-0 truncate text-[var(--p-dim2)]">from {file.name}</span>
          </div>
          <div className="relative min-h-0 flex-1">
            <MemberView name={member.name} path={member.path} kind={member.kind} />
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />
      )}
      {confirmDel && (
        <Dialog
          title={`Delete "${confirmDel.name}" from the archive?`}
          body="This is permanent: a zip has no Recycle Bin to take it back from."
          onCancel={() => setConfirmDel(null)}
          choices={[
            { label: 'Cancel', onPick: () => setConfirmDel(null), primary: true },
            { label: 'Delete', danger: true, onPick: () => doDelete(confirmDel) }
          ]}
        />
      )}
      {oops && (
        <Dialog
          title="Archive"
          body={oops}
          onCancel={() => setOops(null)}
          choices={[{ label: 'OK', onPick: () => setOops(null), primary: true }]}
        />
      )}
    </div>
  )
}

/** Inline rename, Explorer-style: name selected up to the extension. */
function RenameInput({ name, onSubmit, onCancel }: { name: string; onSubmit: (v: string) => void; onCancel: () => void }): JSX.Element {
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
    if (done.current) return
    done.current = true
    if (commit && value.trim() && value.trim() !== name) onSubmit(value.trim())
    else onCancel()
  }
  return (
    <div className="flex h-[26px] items-center">
      <input
        ref={input}
        value={value}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') finish(true)
          else if (e.key === 'Escape') finish(false)
        }}
        className="w-full max-w-[320px] rounded border border-[var(--p-accent-hi)] bg-[var(--p-bg)] px-1.5 py-0.5 text-[12.5px] text-[var(--p-text)] outline-none"
      />
    </div>
  )
}
