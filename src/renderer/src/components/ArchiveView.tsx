import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { FileKind, ViewerFile } from '@shared/types'
import { formatBytes } from '../lib/format'
import { loadTransportStyle } from '../lib/transport'
import { useSysIcon } from '../lib/sysIcon'
import { fileKind } from '@shared/fileKind'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Dialog } from './Dialog'
import { ImageView } from './ImageView'
import { MarkdownView } from './MarkdownView'
import { PdfView } from './pdf/PdfView'
import { VideoView } from './VideoView'
import { AudioView } from './AudioView'
import { KindIcon, iconColour } from './TreeRows'
import { clickSelect, emptySelection, type Selection } from '../lib/selection'
import { DRAG_MIME, dragPayload, droppedPaths, setDrag } from '../lib/dragDrop'
import { archivePassword, rememberArchivePassword } from '../lib/archivePass'
import type { UndoEntry } from '../lib/undo'

const CodeView = lazy(() => import('./CodeView').then((m) => ({ default: m.CodeView })))

// The inside of a zip (#68): Explorer-shaped, not a tree. You are always IN
// one folder of the archive: clicking a folder walks into it, the breadcrumb
// (or Backspace) climbs back out. Verbs live on the right-click menu alone -
// view (extract to temp and show with the ordinary viewers), copy, rename,
// delete (the one permanent delete in Prism; a zip has no recycle bin).
// Password-protected members ask once per archive; ZipCrypto opens, AES says
// so honestly (adm-zip cannot decrypt it).

type Entry = { path: string; name: string; dir: boolean; size: number; encrypted?: boolean }
type Fail = 'password' | 'aes' | 'failed'

const isMarkdown = (name: string): boolean => /\.(md|markdown)$/i.test(name)
const extOf = (name: string): string => /\.[^.]*$/.exec(name.toLowerCase())?.[0] ?? ''
const parentOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

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

function LockBadge(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="var(--p-dim2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-label="Password protected">
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

/** Keyed by path, so switching zip to zip starts the inner state fresh. */
export function ArchiveView({
  file,
  onUndoable,
  refreshKey = 0
}: {
  file: ViewerFile
  /** Something undoable happened in here (a move IN); App keeps the stack. */
  onUndoable?: (entry: UndoEntry) => void
  /** Bumped by App after an undo, so the listing re-reads the container. */
  refreshKey?: number
}): JSX.Element {
  return <ArchiveInner key={file.path} file={file} onUndoable={onUndoable} refreshKey={refreshKey} />
}

function ArchiveInner({
  file,
  onUndoable,
  refreshKey
}: {
  file: ViewerFile
  onUndoable?: (entry: UndoEntry) => void
  refreshKey: number
}): JSX.Element {
  const [entries, setEntries] = useState<Entry[] | null | 'error'>(null)
  const [cwd, setCwdRaw] = useState('')
  const [member, setMember] = useState<{ name: string; path: string; kind: FileKind } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry; multi?: string[] } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<Entry | null>(null)
  const [confirmDelMany, setConfirmDelMany] = useState<string[] | null>(null)
  // Drag and drop (#70). dropTarget is a folder path, or '' for the panel
  // itself (meaning "this folder you are looking at").
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [addClash, setAddClash] = useState<{
    paths: string[]
    dest: string
    names: string[]
    fromPrism: boolean
  } | null>(null)
  // The selection (2026-08-22): click selects, shift ranges, ctrl toggles,
  // double click opens. No drag-to-select; dragging a row moves it.
  const [sel, setSel] = useState<Selection>(emptySelection)
  // Mirrored via effect (refs must not be written during render): a drag
  // starting on a selected row carries the whole selection.
  const selRef = useRef(sel)
  useEffect(() => {
    selRef.current = sel
  }, [sel])
  /** Walking anywhere drops the selection: a new folder is a new slate. */
  const setCwd = useCallback((p: string): void => {
    setCwdRaw(p)
    setSel(emptySelection)
  }, [])
  const [oops, setOops] = useState<string | null>(null)
  // The password lives in lib/archivePass, one per archive, so the SIDEBAR can
  // use it too when a member is dragged out to a folder (#70).
  const [askPass, setAskPass] = useState<{ run: (pw: string) => void; name: string; wrong: boolean } | null>(null)
  const sysIcon = useSysIcon(file.path)

  const load = useCallback(() => {
    void window.prism.archiveList(file.path).then((list) => setEntries(list ?? 'error'))
  }, [file.path])
  useEffect(() => load(), [load, refreshKey])

  // The rows of the CURRENT folder only: folders first, names ordered.
  const rows = useMemo((): Entry[] => {
    if (!entries || entries === 'error') return []
    return entries
      .filter((e) => parentOf(e.path) === cwd)
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  }, [entries, cwd])
  // The label on the box: what the WHOLE archive holds, plus its size on disk.
  const totals = useMemo(() => {
    if (!entries || entries === 'error') return ''
    const folders = entries.filter((e) => e.dir).length
    const files = entries.length - folders
    const parts = [`${files} file${files === 1 ? '' : 's'}`]
    if (folders) parts.push(`${folders} folder${folders === 1 ? '' : 's'}`)
    if (file.size) parts.push(`${formatBytes(file.size)} compressed`)
    return parts.join(' · ')
  }, [entries, file.size])
  const crumbs = cwd ? cwd.split('/') : []

  /** Run a member action; when it reports 'password', ask and retry with the
   *  answer. 'aes' and 'failed' land in the message box. */
  const withPassword = useCallback(
    (entry: Entry, run: (pw: string | undefined) => Promise<Fail | 'ok'>): void => {
      const attempt = (pw: string | undefined, wrong: boolean): void => {
        void run(pw).then((r) => {
          if (r === 'ok') return
          if (r === 'password')
            setAskPass({
              name: entry.name,
              wrong,
              run: (answer) => {
                setAskPass(null)
                rememberArchivePassword(file.path, answer)
                attempt(answer, true)
              }
            })
          else if (r === 'aes')
            setOops(`"${entry.name}" is AES-encrypted, and opening that needs 7-Zip installed. With 7-Zip on this machine Prism opens it in place.`)
          else setOops(`Couldn't read "${entry.name}" from the archive.`)
        })
      }
      attempt(archivePassword(file.path), false)
    },
    [file.path]
  )

  const view = useCallback(
    (entry: Entry): void =>
      withPassword(entry, (pw) =>
        window.prism.archiveExtract(file.path, entry.path, pw).then((r) => {
          if (r.ok) {
            setMember({ name: entry.name, path: r.path, kind: r.kind })
            return 'ok'
          }
          return r.reason
        })
      ),
    [file.path, withPassword]
  )
  const copyOut = useCallback(
    (entry: Entry): void =>
      withPassword(entry, (pw) =>
        window.prism.archiveExtract(file.path, entry.path, pw).then((r) => {
          if (r.ok) {
            void window.prism.copyFileToClipboard(r.path)
            return 'ok'
          }
          return r.reason
        })
      ),
    [file.path, withPassword]
  )
  const submitRename = useCallback(
    (entry: Entry, name: string): void => {
      setEditing(null)
      if (!name || name === entry.name) return
      withPassword(entry, (pw) =>
        window.prism.archiveRename(file.path, entry.path, name, pw).then((r) => {
          if (r === 'ok') {
            load()
            return 'ok'
          }
          if (r === 'failed') {
            setOops(`Couldn't rename to "${name}". The name may be taken or invalid.`)
            return 'ok' // already messaged; don't double up
          }
          return r as Fail
        })
      )
    },
    [file.path, load, withPassword]
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

  // Escape closes the member preview; Backspace climbs out of a folder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (member && e.key === 'Escape') {
        e.stopPropagation()
        setMember(null)
      } else if (!member && e.key === 'Backspace' && cwd && !editing && !askPass && !confirmDel) {
        const el = document.activeElement
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
        e.preventDefault()
        setCwd(parentOf(cwd))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [member, cwd, editing, askPass, confirmDel, setCwd])

  const order = useMemo(() => rows.map((r) => r.path), [rows])
  const onRowClick = useCallback(
    (e: { shiftKey: boolean; ctrlKey: boolean }, path: string): void => {
      setSel((s) => clickSelect(order, s, path, { shift: e.shiftKey, ctrl: e.ctrlKey }))
    },
    [order]
  )
  /** Copy every selected FILE out at once; folders don't extract. */
  const copyMany = useCallback(
    (paths: string[]): void => {
      const files = paths.filter((p) => rows.find((r) => r.path === p && !r.dir))
      void (async () => {
        const out: string[] = []
        let locked = 0
        for (const p of files) {
          const r = await window.prism.archiveExtract(file.path, p, archivePassword(file.path))
          if (r.ok) out.push(r.path)
          else if (r.reason === 'password' || r.reason === 'aes') locked += 1
        }
        if (out.length) void window.prism.copyFilesToClipboard(out)
        if (locked)
          setOops(`${locked} of the selected members are password protected. Open one first to unlock the archive, then copy again.`)
      })()
    },
    [file.path, rows]
  )
  const deleteMany = useCallback(
    (paths: string[]): void => {
      setConfirmDelMany(null)
      void (async () => {
        let failed = 0
        for (const p of paths) {
          if (!(await window.prism.archiveDelete(file.path, p))) failed += 1
        }
        setSel(emptySelection)
        load()
        if (failed) setOops(`${failed} of ${paths.length} couldn't be deleted from the archive.`)
      })()
    },
    [file.path, load]
  )

  const onRowDragStart = useCallback(
    (e: React.DragEvent, path: string): void => {
      const items = selRef.current.items
      setDrag({
        kind: 'members',
        archive: file.path,
        entries: items.has(path) && items.size > 1 ? [...items] : [path]
      })
      e.dataTransfer.setData(DRAG_MIME, 'members')
      e.dataTransfer.effectAllowed = 'move'
    },
    [file.path]
  )
  const addInto = useCallback(
    (paths: string[], dest: string, keepBoth = false, fromPrism = false): void => {
      void window.prism.archiveAdd(file.path, paths, dest, keepBoth).then(async (r) => {
        setAddClash(null)
        if (r === 'encrypted') {
          setOops("Prism can't add to a password-protected archive.")
          return
        }
        if (r === 'failed') {
          setOops("Those couldn't be added to the archive.")
          return
        }
        if (r.clashes.length) {
          setAddClash({ paths, dest, names: r.clashes, fromPrism })
          return
        }
        // Dragging OUT of the sidebar is a MOVE, not a copy (owner, 2026-08-22):
        // once the members are safely inside, the originals go to the Recycle
        // Bin - recoverable, and Ctrl+Z takes back both halves at once. Files
        // dragged from EXPLORER are left alone: they live outside the root, so
        // they were never Prism's to remove.
        if (fromPrism && r.added.length) {
          const originals: string[] = []
          for (const a of r.added) {
            if (await window.prism.trashFile(a.src)) originals.push(a.src)
          }
          onUndoable?.({
            kind: 'archive-in',
            zip: file.path,
            dest,
            entries: r.added.map((a) => a.entry),
            originals
          })
        }
        load()
      })
    },
    [file.path, load, onUndoable]
  )
  /** A drop landed inside the archive: members rearrange, real files come in. */
  const onDropInArchive = useCallback(
    (e: React.DragEvent, destFolder: string): void => {
      setDropTarget(null)
      const payload = dragPayload(e.dataTransfer)
      setDrag(null)
      if (payload?.kind === 'members') {
        if (payload.archive.toLowerCase() !== file.path.toLowerCase()) {
          setOops('That came from another archive. Extract it first, then add it here.')
          return
        }
        void window.prism.archiveMoveMembers(file.path, payload.entries, destFolder).then((r) => {
          if (r === 'ok') {
            setSel(emptySelection)
            load()
          } else
            setOops(
              r === 'encrypted'
                ? "Prism can't rearrange a password-protected archive."
                : "Those couldn't be moved inside the archive. A name may be taken."
            )
        })
        return
      }
      // From the sidebar, or straight from Explorer.
      const fromPrism = payload?.kind === 'files'
      const paths = fromPrism ? payload.paths : droppedPaths(e.dataTransfer)
      if (paths.length) addInto(paths, destFolder, false, fromPrism)
    },
    [addInto, file.path, load]
  )
  /** Everything a drop target needs, folder rows and the panel alike. */
  const dropProps = (dest: string): Record<string, unknown> => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setDropTarget(dest)
    },
    onDragLeave: () => setDropTarget((t) => (t === dest ? null : t)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDropInArchive(e, dest)
    }
  })

  const menuItems = (entry: Entry): MenuItem[] => [
    { label: 'View', onPick: () => view(entry) },
    { label: 'Copy file', onPick: () => copyOut(entry) },
    { label: 'Rename', hint: 'F2', onPick: () => setEditing(entry.path) },
    { label: 'Delete from archive', danger: true, onPick: () => setConfirmDel(entry) }
  ]
  /** Only file members can be copied out or deleted; a folder in the
   *  selection is carried by its members, and counting it made the labels
   *  promise more than the verbs could do. */
  const filesOf = (paths: string[]): string[] =>
    paths.filter((p) => rows.some((r) => r.path === p && !r.dir))
  const multiItems = (paths: string[]): MenuItem[] => {
    const files = filesOf(paths)
    return [
      { label: `Copy ${files.length} file${files.length === 1 ? '' : 's'}`, onPick: () => copyMany(files) },
      {
        label: `Delete ${files.length} from archive`,
        danger: true,
        disabled: !files.length,
        onPick: () => setConfirmDelMany(files)
      }
    ]
  }

  if (entries === 'error')
    return (
      <div className="grid h-full place-items-center text-[13px] text-[var(--p-dim)]">
        Can&apos;t read this archive
      </div>
    )

  return (
    <div className="relative h-full w-full">
      {/* The manifest: the archive introduces itself (its own system icon,
          name, what it holds), and the members live in a bounded panel under
          it - the label on the box. Navigation is Explorer-shaped inside the
          panel; the crumb row appears once you are inside a folder. */}
      <div className="h-full overflow-y-auto">
        <div className="flex flex-col items-center px-6 pb-8 pt-10">
          <span className="mb-2.5 grid h-[52px] w-[52px] place-items-center">
            {sysIcon ? (
              <img src={sysIcon} width={48} height={48} alt="" aria-hidden />
            ) : (
              <KindIcon kind="archive" color="var(--p-tree-archive)" />
            )}
          </span>
          <div className="max-w-[36rem] truncate text-[14px] font-semibold text-[var(--p-text)]">{file.name}</div>
          <div className="mt-1 text-[11.5px] text-[var(--p-dim)]">{totals || ' '}</div>

          <div className="mt-4 w-full max-w-[560px]">
            {/* The crumb row is always present, root included: the archive
                itself is the first crumb wherever you stand, so the path
                reads the same coming back as it did going in (and the panel
                never jumps a line). */}
            <div data-archive-crumbs className="mb-1 flex h-6 items-center gap-1 px-1 text-[12px]">
              <button
                className={`no-drag rounded px-1 py-0.5 ${crumbs.length ? 'text-[var(--p-dim)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]' : 'text-[var(--p-text)]'}`}
                onClick={() => setCwd('')}
              >
                {file.name}
              </button>
              {crumbs.length > 0 && (
                <>
                {crumbs.map((seg, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span className="text-[var(--p-dim2)]">/</span>
                    <button
                      className={`no-drag rounded px-1 py-0.5 ${i < crumbs.length - 1 ? 'text-[var(--p-dim)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]' : 'text-[var(--p-text)]'}`}
                      onClick={() => setCwd(crumbs.slice(0, i + 1).join('/'))}
                    >
                      {seg}
                    </button>
                  </span>
                ))}
                </>
              )}
            </div>
            <div
              className={`rounded-lg border bg-[var(--p-side-flat)] p-1.5 ${
                dropTarget === cwd
                  ? 'border-[color:var(--p-accent-hi)]'
                  : 'border-[color:var(--p-divider)]'
              }`}
              {...dropProps(cwd)}
            >
          {entries === null ? (
            <div className="px-3 py-2 text-[12px] italic text-[var(--p-dim2)]">loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-2 text-[12px] italic text-[var(--p-dim2)]">
              {cwd ? 'empty folder' : 'empty archive'}
            </div>
          ) : (
            <ul role="listbox" aria-label={`Contents of ${cwd || file.name}`} className="list-none">
              {rows.map((r) =>
                editing === r.path ? (
                  <li key={r.path} className="px-2">
                    <RenameInput name={r.name} onSubmit={(v) => submitRename(r, v)} onCancel={() => setEditing(null)} />
                  </li>
                ) : (
                  <li key={r.path}>
                    {/* A div, not a button, so dialogs and menus can hold
                        buttons of their own; Enter activates by hand. Click
                        SELECTS (shift ranges, ctrl toggles); double click is
                        what opens or enters. */}
                    <div
                      role="option"
                      tabIndex={0}
                      aria-selected={sel.items.has(r.path)}
                      data-selected={sel.items.has(r.path) || undefined}
                      className={`flex h-[28px] w-full cursor-pointer items-center gap-2 rounded-[var(--p-radius-sm)] px-2.5 text-left text-[12.5px] outline-none ${
                        dropTarget === r.path
                          ? 'bg-[var(--p-hover-hi)] text-[var(--p-text)] ring-1 ring-inset ring-[var(--p-accent-hi)]'
                          : sel.items.has(r.path)
                          ? 'bg-[var(--p-sel-bg)] font-medium text-[var(--p-on-accent)]'
                          : 'text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] focus-visible:bg-[var(--p-hover)]'
                      }`}
                      style={
                        // Contiguous selected rows fuse into one block.
                        sel.items.has(r.path)
                          ? (() => {
                              const i = order.indexOf(r.path)
                              const top = i > 0 && sel.items.has(order[i - 1])
                              const bottom = i >= 0 && i < order.length - 1 && sel.items.has(order[i + 1])
                              return {
                                borderTopLeftRadius: top ? 0 : undefined,
                                borderTopRightRadius: top ? 0 : undefined,
                                borderBottomLeftRadius: bottom ? 0 : undefined,
                                borderBottomRightRadius: bottom ? 0 : undefined
                              }
                            })()
                          : undefined
                      }
                      draggable
                      onDragStart={(e) => onRowDragStart(e, r.path)}
                      onDragEnd={() => {
                        setDropTarget(null)
                        setDrag(null)
                      }}
                      {...(r.dir ? dropProps(r.path) : {})}
                      onClick={(e) => onRowClick(e, r.path)}
                      onDoubleClick={() => (r.dir ? setCwd(r.path) : view(r))}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        const multi =
                          sel.items.has(r.path) && sel.items.size > 1 ? [...sel.items] : undefined
                        if (!multi) setSel({ anchor: r.path, items: new Set([r.path]) })
                        if (r.dir && !multi) return // single folders have no verbs yet
                        setMenu({ x: e.clientX, y: e.clientY, entry: r, multi })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (r.dir) setCwd(r.path)
                          else view(r)
                        } else if (!r.dir && e.key === 'F2') {
                          e.preventDefault()
                          setEditing(r.path)
                        } else if (e.key === 'Delete') {
                          e.preventDefault()
                          if (sel.items.size > 1 && sel.items.has(r.path)) setConfirmDelMany(filesOf([...sel.items]))
                          else if (!r.dir) setConfirmDel(r)
                        }
                      }}
                    >
                      {r.dir ? (
                        <svg viewBox="0 0 24 24" width={14} height={14} fill="var(--p-tree-folder)" className="shrink-0" aria-hidden>
                          <path d="M2.8 6.2A1.8 1.8 0 0 1 4.6 4.4h4.3l2 2h8.5a1.8 1.8 0 0 1 1.8 1.8v9.6a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8z" />
                        </svg>
                      ) : (
                        <KindIcon kind={fileKind(extOf(r.name), r.name)} color={iconColour(fileKind(extOf(r.name), r.name))} />
                      )}
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      {r.encrypted && <LockBadge />}
                      {!r.dir && (
                        <span className="w-[72px] shrink-0 text-right text-[11px] tabular-nums text-[var(--p-dim2)]">
                          {formatBytes(r.size)}
                        </span>
                      )}
                    </div>
                  </li>
                )
              )}
            </ul>
          )}
            </div>
          </div>
        </div>
      </div>

      {member && (
        <div data-owns-escape className="absolute inset-0 z-20 flex flex-col bg-[var(--p-bg)]">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--p-divider)] px-2 text-[12.5px]">
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
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.multi ? multiItems(menu.multi) : menuItems(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}
      {addClash && (
        <Dialog
          title={
            addClash.names.length > 1
              ? `${addClash.names.length} names are already in the archive`
              : `"${addClash.names[0]}" is already in the archive`
          }
          body="Keep both adds them beside what is there. Nothing has been written yet."
          onCancel={() => setAddClash(null)}
          choices={[
            { label: 'Cancel', onPick: () => setAddClash(null) },
            {
              label: 'Keep both',
              primary: true,
              onPick: () => addInto(addClash.paths, addClash.dest, true, addClash.fromPrism)
            }
          ]}
        />
      )}
      {confirmDelMany && (
        <Dialog
          title={`Delete ${confirmDelMany.length} members from the archive?`}
          body="This is permanent: a zip has no Recycle Bin to take them back from."
          onCancel={() => setConfirmDelMany(null)}
          choices={[
            { label: 'Cancel', onPick: () => setConfirmDelMany(null), primary: true },
            { label: 'Delete', danger: true, onPick: () => deleteMany(confirmDelMany) }
          ]}
        />
      )}
      {askPass && (
        <PasswordDialog
          name={askPass.name}
          wrong={askPass.wrong}
          onSubmit={askPass.run}
          onCancel={() => setAskPass(null)}
        />
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

/** The password question, asked once per archive and remembered after. */
function PasswordDialog({ name, wrong, onSubmit, onCancel }: {
  name: string
  wrong: boolean
  onSubmit: (pw: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  return (
    <Dialog
      title="This archive is password protected"
      body={
        <div>
          <div>{wrong ? `That password didn't open "${name}". Try again:` : `Enter the password to open "${name}":`}</div>
          <input
            ref={input}
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && value) onSubmit(value)
            }}
            className="mt-2.5 w-full rounded border border-[color:var(--p-divider)] bg-[var(--p-bg)] px-2 py-1.5 text-[12.5px] text-[var(--p-text)] outline-none focus:border-[color:var(--p-accent-hi)]"
            aria-label="Archive password"
          />
        </div>
      }
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        { label: 'Unlock', primary: true, onPick: () => value && onSubmit(value) }
      ]}
    />
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
    <div className="flex h-[28px] items-center">
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
