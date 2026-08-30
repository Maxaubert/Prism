import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { FileKind, ViewerFile } from '@shared/types'
import { formatBytes, formatWhen, savedPercent } from '../lib/format'
import { typeLabel } from '../lib/typeLabel'
import { loadTransportBg, loadTransportStyle } from '../lib/transport'
import { useSysIcon } from '../lib/sysIcon'
import { fileKind } from '@shared/fileKind'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Dialog } from './Dialog'
import { ImageView } from './ImageView'
import { VideoView } from './VideoView'
import { AudioView } from './AudioView'
import { KindIcon, iconColour } from './TreeRows'
import { clickSelect, emptySelection, type Selection } from '../lib/selection'
import { DRAG_MIME, dragPayload, droppedPaths, setDrag } from '../lib/dragDrop'
import { archivePassword, rememberArchivePassword } from '../lib/archivePass'
import type { UndoEntry } from '../lib/undo'

// Lazy for the same reason App splits them: opening a zip should not carry
// pdf.js and the markdown pipeline into the launch bundle. A member preview
// waits a frame for its viewer; that is what MemberView's Suspense is for.
const CodeView = lazy(() => import('./CodeView').then((m) => ({ default: m.CodeView })))
const MarkdownView = lazy(() =>
  import('./MarkdownView').then((m) => ({ default: m.MarkdownView }))
)
const PdfView = lazy(() => import('./pdf/PdfView').then((m) => ({ default: m.PdfView })))

// The inside of a zip (#68): Explorer-shaped, not a tree. You are always IN
// one folder of the archive: clicking a folder walks into it, the breadcrumb
// (or Backspace) climbs back out. Verbs live on the right-click menu alone -
// view (extract to temp and show with the ordinary viewers), copy, rename,
// delete (the one permanent delete in Prism; a zip has no recycle bin).
// Password-protected members ask once per archive; ZipCrypto opens, AES says
// so honestly (adm-zip cannot decrypt it).

type Entry = {
  path: string
  name: string
  dir: boolean
  size: number
  /** What the member occupies inside the container; folders have none. */
  packed?: number
  /** The entry's own modified time, epoch ms, as the container recorded it. */
  mtime?: number
  encrypted?: boolean
}
type Fail = 'password' | 'aes' | 'failed'

// The columns, Explorer-shaped. The widths live in one place because the
// header row and every member row have to agree to the pixel, and the narrow
// ones step out of the way on a small window rather than crushing the name:
// the name is the column you cannot do without.
const COL_TYPE = 'hidden w-[140px] shrink-0 truncate md:block'
const COL_SIZE = 'w-[86px] shrink-0 text-right tabular-nums'
const COL_PACKED = 'hidden w-[128px] shrink-0 text-right tabular-nums xl:block'
const COL_WHEN = 'hidden w-[150px] shrink-0 text-right tabular-nums lg:block'

const isMarkdown = (name: string): boolean => /\.(md|markdown)$/i.test(name)
const extOf = (name: string): string => /\.[^.]*$/.exec(name.toLowerCase())?.[0] ?? ''
const parentOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** The extracted member, shown with the same viewers the folder uses. */
function MemberView({
  name,
  path,
  kind
}: {
  name: string
  path: string
  kind: FileKind
}): JSX.Element {
  const url = window.prism.mediaUrl(path)
  const noop = useCallback(() => {}, [])
  switch (kind) {
    case 'image':
      return <ImageView url={url} name={name} onToggleFullscreen={noop} />
    case 'video':
      return (
        <VideoView
          url={url}
          path={path}
          onToggleFullscreen={noop}
          onAutoAdvance={noop}
          onStep={noop}
          canStep={() => false}
          transportStyle={loadTransportStyle()}
          transportBg={loadTransportBg()}
        />
      )
    case 'audio':
      return (
        <AudioView
          url={url}
          path={path}
          name={name}
          fullscreen={false}
          onToggleFullscreen={noop}
          onAutoAdvance={noop}
          transportStyle={loadTransportStyle()}
        />
      )
    case 'pdf':
      return (
        <Suspense fallback={null}>
          <PdfView url={url} onToggleFullscreen={noop} />
        </Suspense>
      )
    case 'text':
      return isMarkdown(name) ? (
        <Suspense fallback={null}>
          <MarkdownView path={path} onOpenLocal={noop} />
        </Suspense>
      ) : (
        <Suspense fallback={null}>
          <CodeView
            path={path}
            name={name}
            onSaved={noop}
            onBuffer={noop}
            getPending={() => undefined}
          />
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
    <svg
      viewBox="0 0 24 24"
      width={11}
      height={11}
      fill="none"
      stroke="var(--p-dim2)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-label="Password protected"
    >
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

/** Keyed by path, so switching zip to zip starts the inner state fresh. */
export function ArchiveView({
  file,
  onUndoable,
  onRenameSelf,
  refreshKey = 0,
  fullscreen = false
}: {
  file: ViewerFile
  /** Something undoable happened in here (a move IN); App keeps the stack. */
  onUndoable?: (entry: UndoEntry) => void
  /** Rename the archive FILE itself. Handed up to App, which owns renaming:
   *  it knows how to answer a taken name, how to follow the file that just
   *  moved, and how to put the rename on the undo stack. */
  onRenameSelf?: (name: string) => void
  /** Bumped by App after an undo, so the listing re-reads the container. */
  refreshKey?: number
  /** Fullscreen makes the row KEYS inert (2026-08-28). A rename or a delete
   *  that a keystroke starts while the tree, the crumbs and the dialogs are
   *  off screen is a change nobody saw coming; a click on a verb, which is
   *  visible and deliberate, still works. */
  fullscreen?: boolean
}): JSX.Element {
  return (
    <ArchiveInner
      key={file.path}
      fullscreen={fullscreen}
      file={file}
      onUndoable={onUndoable}
      onRenameSelf={onRenameSelf}
      refreshKey={refreshKey}
    />
  )
}

function ArchiveInner({
  file,
  onUndoable,
  onRenameSelf,
  refreshKey,
  fullscreen
}: {
  file: ViewerFile
  onUndoable?: (entry: UndoEntry) => void
  onRenameSelf?: (name: string) => void
  refreshKey: number
  fullscreen: boolean
}): JSX.Element {
  // 'locked' is its own state (2026-08-30): a 7z or rar written with encrypted
  // file NAMES cannot be listed at all without the password, which is not the
  // same thing as a broken archive and must not read as one.
  const [entries, setEntries] = useState<Entry[] | null | 'error' | 'locked'>(null)
  // 7z, rar, tar and the rest are read through 7-Zip and never written, so the
  // panel offers no verbs that would fail. zip keeps all of its.
  const [readOnly, setReadOnly] = useState(false)
  /** A password has already been tried and refused, so the dialog says so. */
  const [triedPass, setTriedPass] = useState(false)
  useEffect(() => {
    void window.prism.archiveStat(file.path).then((st) => setReadOnly(!!st?.readOnly))
  }, [file.path])
  const [cwd, setCwdRaw] = useState('')
  const [member, setMember] = useState<{ name: string; path: string; kind: FileKind } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry; multi?: string[] } | null>(
    null
  )
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
  /** Where "Extract all" put things, so the note can offer to show you. */
  const [extracted, setExtracted] = useState<string | null>(null)
  const [busy, setBusy] = useState<'extract' | 'add' | null>(null)
  /** Renaming the archive itself, from the verb row. */
  const [renamingSelf, setRenamingSelf] = useState(false)
  /** The drag-select band, in the panel box's own coordinates. */
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // The password lives in lib/archivePass, one per archive, so the SIDEBAR can
  // use it too when a member is dragged out to a folder (#70).
  const [askPass, setAskPass] = useState<{
    run: (pw: string) => void
    name: string
    wrong: boolean
  } | null>(null)
  const sysIcon = useSysIcon(file.path)

  const load = useCallback(
    (password?: string) => {
      void window.prism.archiveList(file.path, password).then((r) => {
        if (r.ok) {
          // A password that got us in belongs to the renderer's own store too,
          // so dragging a member out to a folder does not ask again.
          if (password) rememberArchivePassword(file.path, password)
          setEntries(r.entries)
          return
        }
        setEntries(r.reason === 'password' ? 'locked' : 'error')
      })
    },
    [file.path]
  )
  useEffect(() => load(), [load, refreshKey])

  // The rows of the CURRENT folder only: folders first, names ordered.
  const rows = useMemo((): Entry[] => {
    if (!entries || entries === 'error' || entries === 'locked') return []
    return entries
      .filter((e) => parentOf(e.path) === cwd)
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  }, [entries, cwd])
  // The label on the box: what the WHOLE archive holds, plus its size on disk.
  const totals = useMemo(() => {
    if (!entries || entries === 'error' || entries === 'locked') return ''
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
            // Prism ships its own 7-Zip, so reaching this now means the
            // bundled copy is missing rather than that the machine lacks one.
            setOops(
              `"${entry.name}" is AES-encrypted, and the 7-Zip that opens those is missing from this install.`
            )
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
          setOops(
            `${locked} of the selected members are password protected. Open one first to unlock the archive, then copy again.`
          )
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

  /** How many entries a folder holds, all the way down: what the Size column
   *  says for a row that has no size of its own. */
  const childCount = useCallback(
    (path: string): string => {
      if (!entries || entries === 'error' || entries === 'locked') return ''
      const n = entries.filter((e) => e.path.startsWith(path + '/')).length
      return n ? `${n} item${n === 1 ? '' : 's'}` : 'empty'
    },
    [entries]
  )

  /** Extract the whole thing. Main asks where (its dialog IS the consent, and
   *  is why the destination need not be inside a Prism root), and puts the
   *  contents in a folder named after the archive. */
  const extractAll = useCallback((): void => {
    setBusy('extract')
    void window.prism.archiveExtractAll(file.path).then((r) => {
      setBusy(null)
      if (r.ok) setExtracted(r.dest)
      else if (r.reason === 'cancelled') return
      else if (r.reason === 'password')
        setOops(
          'This archive is password protected. Open a member first to unlock it, then extract.'
        )
      else setOops("That archive couldn't be extracted.")
    })
  }, [file.path])

  /**
   * Drag-select, the archive's alone (2026-08-25).
   *
   * The tree's sweep was removed because its pointer state outlived real drags
   * - a dropped folder started a phantom band with no button held. This one
   * cannot: it begins ONLY on dead space (a row starts an HTML5 drag instead,
   * and never reaches here), and its listeners are on `window`, removed by
   * pointerup AND pointercancel, so releasing anywhere at all ends it.
   *
   * A plain press on dead space also clears the selection, which is the other
   * half of what dead space should mean.
   */
  const panelBox = useRef<HTMLDivElement>(null)
  /** Was the last press in here? Ctrl+A belongs to the surface you are in. */
  const hasFocus = useRef(false)
  const onPanelPointerDown = useCallback((e: React.PointerEvent): void => {
    hasFocus.current = true
    if (e.button !== 0) return
    const el = e.target as HTMLElement | null
    if (el?.closest('[data-arc-row]')) return // the row owns its own click
    const box = panelBox.current
    if (!box) return
    if (!e.ctrlKey && !e.shiftKey) setSel(emptySelection)
    const rect = box.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    const base = e.ctrlKey ? new Set(selRef.current.items) : new Set<string>()
    const move = (ev: PointerEvent): void => {
      const x = Math.min(sx, ev.clientX)
      const y = Math.min(sy, ev.clientY)
      const w = Math.abs(ev.clientX - sx)
      const h = Math.abs(ev.clientY - sy)
      if (w < 4 && h < 4) return // a click, not a sweep
      setBand({ x: x - rect.left, y: y - rect.top, w, h })
      const hits = new Set(base)
      box.querySelectorAll<HTMLElement>('[data-arc-row]').forEach((row) => {
        const r = row.getBoundingClientRect()
        if (r.bottom > y && r.top < y + h && r.right > x && r.left < x + w) {
          const p = row.dataset.arcRow
          if (p) hits.add(p)
        }
      })
      setSel((s) => ({ anchor: s.anchor, items: hits }))
    }
    const end = (): void => {
      setBand(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }, [])

  /**
   * A press ANYWHERE else drops the marks (2026-08-25).
   *
   * Highlighting is meant to say "these are the ones I am about to act on", so
   * it should not survive walking away from them. What remains marked is the
   * ARCHIVE itself over in the sidebar, because that is the thing you are
   * actually looking at. Menus and dialogs are exempt: they ARE the act on
   * the selection.
   */
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null
      if (!el || panelBox.current?.contains(el)) return
      if (el.closest('[role="menu"],[role="dialog"],[data-owns-escape]')) return
      hasFocus.current = false
      setSel((s) => (s.items.size ? emptySelection : s))
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [])

  /** Ctrl+A marks everything in the folder you are looking at - this folder,
   *  not the whole archive, which is what Explorer means by it too. Only
   *  while the panel is the surface you last touched, and never while
   *  something is being typed into. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || (e.key !== 'a' && e.key !== 'A')) return
      if (!hasFocus.current || member) return
      const el = e.target as HTMLElement | null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      e.preventDefault()
      setSel({ anchor: order[0] ?? null, items: new Set(order) })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [order, member])

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
  /** Add real files to the folder you are looking at. zip only: the 7-Zip
   *  containers are read-only, and their button is not offered. */
  const addFiles = useCallback((): void => {
    setBusy('add')
    void window.prism.pickFiles().then((paths) => {
      setBusy(null)
      if (paths.length) addInto(paths, cwd, false, false)
    })
  }, [addInto, cwd])

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

  /** The quiet columns are dim, except on a selected row, where dim on the
   *  accent fill is unreadable. */
  const colTone = (path: string): string =>
    sel.items.has(path) ? 'text-[var(--p-on-accent)] opacity-75' : 'text-[var(--p-dim2)]'

  /** Every FILE member inside a folder, at any depth. A folder in a zip is a
   *  prefix, not a container, so its verbs act on what carries that prefix. */
  const under = (folder: string): string[] =>
    (entries === null || entries === 'error' || entries === 'locked' ? [] : entries)
      .filter((e) => !e.dir && (e.path === folder || e.path.startsWith(folder + '/')))
      .map((e) => e.path)

  /**
   * A FOLDER row's menu (2026-08-30).
   *
   * Right-clicking one used to open nothing at all, which reads as a broken
   * app rather than as a limit. Its verbs are the ones that mean something for
   * a prefix: walk into it, copy out everything under it, delete all of that.
   * No rename: renaming a folder inside a zip means rewriting every member
   * path under it, and that is a decision, not a gap to be filled here.
   */
  const folderItems = (entry: Entry): MenuItem[] => {
    const members = under(entry.path)
    const n = members.length
    const items: MenuItem[] = [
      { label: 'Open', onPick: () => setCwd(entry.path) },
      {
        label: `Copy ${n} file${n === 1 ? '' : 's'}`,
        disabled: n === 0,
        onPick: () => copyMany(members)
      }
    ]
    if (!readOnly)
      items.push({
        label: `Delete ${n} file${n === 1 ? '' : 's'} from archive`,
        danger: true,
        disabled: n === 0,
        onPick: () => setConfirmDelMany(members)
      })
    return items
  }

  const menuItems = (entry: Entry): MenuItem[] =>
    entry.dir
      ? folderItems(entry)
      : readOnly
        ? [
            { label: 'View', onPick: () => view(entry) },
            { label: 'Copy file', onPick: () => copyOut(entry) }
          ]
        : [
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
    if (readOnly) {
      return [
        {
          label: `Copy ${files.length} file${files.length === 1 ? '' : 's'}`,
          onPick: () => copyMany(files)
        }
      ]
    }
    return [
      {
        label: `Copy ${files.length} file${files.length === 1 ? '' : 's'}`,
        onPick: () => copyMany(files)
      },
      {
        label: `Delete ${files.length} from archive`,
        danger: true,
        disabled: !files.length,
        onPick: () => setConfirmDelMany(files)
      }
    ]
  }

  // Locked is a question, not a failure: the archive is fine, it wants the
  // password before it will even say what is inside.
  if (entries === 'locked')
    return (
      <PasswordDialog
        name={file.name}
        wrong={triedPass}
        onCancel={() => setEntries('error')}
        onSubmit={(pw) => {
          setTriedPass(true)
          setEntries(null)
          load(pw)
        }}
      />
    )

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
      <div className="flex h-full flex-col items-center px-8 pb-6 pt-6">
        <span className="mb-2.5 grid h-[52px] w-[52px] place-items-center">
          {sysIcon ? (
            <img src={sysIcon} width={48} height={48} alt="" aria-hidden />
          ) : (
            <KindIcon kind="archive" color="var(--p-tree-archive)" />
          )}
        </span>
        <div className="max-w-[36rem] truncate text-[14px] font-semibold text-[var(--p-text)]">
          {file.name}
        </div>
        <div className="mt-1 text-[11.5px] text-[var(--p-dim)]">{totals || ' '}</div>

        {/* The verbs that act on the WHOLE archive (2026-08-25). Row verbs
            stay on the right-click menu; these are the ones you come to an
            archive to do, and hunting a menu for "extract" was the gap. */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          <ArcVerb
            label={busy === 'extract' ? 'Extracting…' : 'Extract all…'}
            disabled={busy !== null}
            onClick={extractAll}
            path="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14"
          />
          {!readOnly && (
            <ArcVerb
              label="Add files…"
              disabled={busy !== null}
              onClick={addFiles}
              path="M12 5v14M5 12h14"
            />
          )}
          <ArcVerb
            label="Copy"
            onClick={() => void window.prism.copyFileToClipboard(file.path)}
            path="M9 9h10v10H9zM5 15V5h10"
          />
          {onRenameSelf && (
            <ArcVerb
              label="Rename…"
              onClick={() => setRenamingSelf(true)}
              path="M4 20h4L19 9l-4-4L4 16z"
            />
          )}
          <ArcVerb
            label="Show in Explorer"
            onClick={() => window.prism.showInExplorer(file.path)}
            path="M3 7h6l2 2h10v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"
          />
        </div>

        <div className="mt-3.5 flex min-h-0 w-full max-w-[1280px] flex-1 flex-col">
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
            ref={panelBox}
            onPointerDown={onPanelPointerDown}
            className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-[var(--p-side-flat)] ${
              dropTarget === cwd
                ? 'border-[color:var(--p-accent-hi)]'
                : 'border-[color:var(--p-divider)]'
            }`}
            {...dropProps(cwd)}
          >
            {/* The column header sits ABOVE the list rather than sticky inside
                it, so a name never slides under it. */}
            <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[color:var(--p-divider)] px-4 text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--p-dim2)]">
              <span className="min-w-0 flex-1">Name</span>
              <span className={COL_TYPE}>Type</span>
              <span className={COL_SIZE}>Size</span>
              <span className={COL_PACKED}>Packed</span>
              <span className={COL_WHEN}>Modified</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {entries === null ? (
                <div className="px-3 py-2 text-[12px] italic text-[var(--p-dim2)]">loading…</div>
              ) : rows.length === 0 ? (
                <div className="px-3 py-2 text-[12px] italic text-[var(--p-dim2)]">
                  {cwd ? 'empty folder' : 'empty archive'}
                </div>
              ) : (
                <ul
                  role="listbox"
                  aria-label={`Contents of ${cwd || file.name}`}
                  className="list-none"
                >
                  {rows.map((r) =>
                    editing === r.path ? (
                      <li key={r.path} className="px-2">
                        <RenameInput
                          name={r.name}
                          onSubmit={(v) => submitRename(r, v)}
                          onCancel={() => setEditing(null)}
                        />
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
                          data-arc-row={r.path}
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
                                  const bottom =
                                    i >= 0 && i < order.length - 1 && sel.items.has(order[i + 1])
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
                              sel.items.has(r.path) && sel.items.size > 1
                                ? [...sel.items]
                                : undefined
                            if (!multi) setSel({ anchor: r.path, items: new Set([r.path]) })
                            setMenu({ x: e.clientX, y: e.clientY, entry: r, multi })
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              if (r.dir) setCwd(r.path)
                              else view(r)
                            } else if (!r.dir && e.key === 'F2' && !readOnly && !fullscreen) {
                              e.preventDefault()
                              setEditing(r.path)
                            } else if (e.key === 'Delete' && !readOnly && !fullscreen) {
                              e.preventDefault()
                              if (sel.items.size > 1 && sel.items.has(r.path))
                                setConfirmDelMany(filesOf([...sel.items]))
                              else if (!r.dir) setConfirmDel(r)
                            }
                          }}
                        >
                          {r.dir ? (
                            <svg
                              viewBox="0 0 24 24"
                              width={14}
                              height={14}
                              fill="var(--p-tree-folder)"
                              className="shrink-0"
                              aria-hidden
                            >
                              <path d="M2.8 6.2A1.8 1.8 0 0 1 4.6 4.4h4.3l2 2h8.5a1.8 1.8 0 0 1 1.8 1.8v9.6a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8z" />
                            </svg>
                          ) : (
                            <KindIcon
                              kind={fileKind(extOf(r.name), r.name)}
                              color={iconColour(fileKind(extOf(r.name), r.name))}
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate">{r.name}</span>
                          {r.encrypted && <LockBadge />}
                          <span className={`${COL_TYPE} text-[11px] ${colTone(r.path)}`}>
                            {typeLabel(r.name, r.dir)}
                          </span>
                          <span className={`${COL_SIZE} text-[11px] ${colTone(r.path)}`}>
                            {r.dir ? childCount(r.path) : formatBytes(r.size)}
                          </span>
                          <span className={`${COL_PACKED} text-[11px] ${colTone(r.path)}`}>
                            {r.dir ? (
                              ''
                            ) : (
                              <>
                                {formatBytes(r.packed ?? r.size)}
                                {savedPercent(r.size, r.packed) && (
                                  // A minus, so the number reads as "smaller by"
                                  // rather than as a ratio of the original.
                                  <span className="ml-1.5 opacity-70">
                                    {'−'}
                                    {savedPercent(r.size, r.packed)}
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                          <span className={`${COL_WHEN} text-[11px] ${colTone(r.path)}`}>
                            {formatWhen(r.mtime)}
                          </span>
                        </div>
                      </li>
                    )
                  )}
                </ul>
              )}
            </div>
            {band && (
              <div
                data-arc-band
                className="pointer-events-none absolute rounded-[3px] border border-[color:var(--p-accent-hi)]"
                style={{
                  left: band.x,
                  top: band.y,
                  width: band.w,
                  height: band.h,
                  background: 'color-mix(in srgb, var(--p-accent) 22%, transparent)'
                }}
              />
            )}
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
              <svg
                viewBox="0 0 24 24"
                width={13}
                height={13}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
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
      {extracted && (
        <Dialog
          title="Extracted"
          body={
            <>
              Everything in this archive is now in <b>{extracted}</b>.
            </>
          }
          onCancel={() => setExtracted(null)}
          choices={[
            { label: 'Close', onPick: () => setExtracted(null) },
            {
              label: 'Show me',
              primary: true,
              onPick: () => {
                window.prism.showInExplorer(extracted)
                setExtracted(null)
              }
            }
          ]}
        />
      )}
      {renamingSelf && (
        <RenameArchiveDialog
          name={file.name}
          onCancel={() => setRenamingSelf(false)}
          onSubmit={(v) => {
            setRenamingSelf(false)
            if (v && v !== file.name) onRenameSelf?.(v)
          }}
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
function PasswordDialog({
  name,
  wrong,
  onSubmit,
  onCancel
}: {
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
          <div>
            {wrong
              ? `That password didn't open "${name}". Try again:`
              : `Enter the password to open "${name}":`}
          </div>
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
function RenameInput({
  name,
  onSubmit,
  onCancel
}: {
  name: string
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

/**
 * One verb in the archive's own row of them: a quiet pill, icon then label.
 *
 * Deliberately not the row hover-verbs that were tried and rejected twice
 * (#68): these act on the whole archive, they are always in the same place,
 * and nothing appears or disappears under the pointer.
 */
function ArcVerb({
  label,
  path,
  onClick,
  disabled
}: {
  label: string
  /** The icon's SVG path data, drawn in currentColor. */
  path: string
  onClick: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="no-drag flex h-[26px] items-center gap-1.5 rounded-[var(--p-radius-sm)] border border-[color:var(--p-divider)] px-2.5 text-[11.5px] text-[var(--p-text-soft)] transition-colors hover:border-[color:var(--p-accent-hi)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] disabled:cursor-default disabled:opacity-50 disabled:hover:border-[color:var(--p-divider)] disabled:hover:bg-transparent"
    >
      <svg
        viewBox="0 0 24 24"
        width={12}
        height={12}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 opacity-80"
        aria-hidden
      >
        <path d={path} />
      </svg>
      {label}
    </button>
  )
}

/** Renaming the archive itself. The answer goes to App, which owns renaming
 *  (taken names, following the open file, the undo stack). */
function RenameArchiveDialog({
  name,
  onSubmit,
  onCancel
}: {
  name: string
  onSubmit: (v: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    const dot = name.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : name.length)
  }, [name])
  return (
    <Dialog
      title="Rename archive"
      body={
        <input
          ref={input}
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') onSubmit(value.trim())
          }}
          className="mt-2.5 w-full rounded border border-[color:var(--p-divider)] bg-[var(--p-bg)] px-2 py-1.5 text-[12.5px] text-[var(--p-text)] outline-none focus:border-[color:var(--p-accent-hi)]"
        />
      }
      onCancel={onCancel}
      choices={[
        { label: 'Cancel', onPick: onCancel },
        { label: 'Rename', primary: true, onPick: () => onSubmit(value.trim()) }
      ]}
    />
  )
}
