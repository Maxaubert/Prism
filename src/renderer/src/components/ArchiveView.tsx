import { copyFilePaths } from '../lib/fileClipboard'
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { withImpliedFolders } from '@shared/archiveTree'
import type { FileKind, ViewerFile } from '@shared/types'
import { formatBytes, formatWhen, savedPercent } from '../lib/format'
import { typeLabel } from '../lib/typeLabel'
import { loadTransportBg, loadTransportStyle } from '../lib/transport'
import { useSysIcon } from '../lib/sysIcon'
import { fileKind } from '@shared/fileKind'
import { baseName, extOf, naturalCompare, parentDir } from '@shared/path'
import { ContextMenu } from './ContextMenu'
import { archivePanelMenu, archiveRowMenu } from '../menus/viewers/archivePanel'
import { PasswordDialog } from './PasswordDialog'
import { ViewerSwitch } from './ViewerSwitch'
import { KindIcon, iconColour } from './TreeRows'
import { Spinner } from './LoadingState'
import { markedLook } from '../lib/markedLook'
import { clickSelect, emptySelection, type Selection } from '../lib/selection'
import { DRAG_MIME, dragPayload, droppedPaths, setDrag } from '../lib/dragDrop'
import { archivePassword, rememberArchivePassword } from '../lib/archivePass'
import { useArchiveOps } from './archive/useArchiveOps'
import { RenameField } from './RenameField'
import { BrowseRename } from './browse/BrowseRename'
import type { UndoEntry } from '../lib/undo'
import { isTypingTarget } from '../lib/focusGuards'

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

// The columns, Explorer-shaped. The widths live in one place because the
// header row and every member row have to agree to the pixel, and the narrow
// ones step out of the way on a small window rather than crushing the name:
// the name is the column you cannot do without.
const COL_TYPE = 'hidden w-[140px] shrink-0 truncate md:block'
const COL_SIZE = 'w-[86px] shrink-0 text-right tabular-nums'
const COL_PACKED = 'hidden w-[128px] shrink-0 text-right tabular-nums xl:block'
const COL_WHEN = 'hidden w-[150px] shrink-0 text-right tabular-nums lg:block'

/** The extracted member, shown with the same viewers the folder uses. */
function MemberView({
  name,
  path,
  kind,
  trail
}: {
  name: string
  path: string
  kind: FileKind
  trail?: { label: string; onBack: () => void }[]
}): JSX.Element {
  const file: ViewerFile = {
    path,
    name,
    ext: name.slice(name.lastIndexOf('.')),
    kind,
    size: 0,
    mtimeMs: 0
  }
  return (
    <ViewerSwitch
      file={file}
      mode="member"
      loading={null}
      transportStyle={loadTransportStyle()}
      transportBg={loadTransportBg()}
      // A ZIP INSIDE A ZIP navigates like any other archive rather than
      // dead-ending on "no viewer" (2026-09-01). It is an ordinary thing to
      // meet - a game rip, a backup of a backup - and the member is a real
      // file on disk by the time it gets here, so the panel that reads an
      // archive can simply read this one. Recursion is bounded by the reader:
      // each level is one more preview, and Escape closes them in turn.
      archive={() => <ArchiveView trail={trail} file={file} />}
      unsupported={() => (
        <div className="grid h-full place-items-center text-[13px] text-[var(--p-dim)]">
          No viewer for this file type
        </div>
      )}
    />
  )
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
  fullscreen = false,
  trail
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
  /** The archives this one is nested INSIDE, outermost first.
   *
   *  A nested archive continues the crumb row it was opened from rather than
   *  starting a second one: an iso inside a zip reads
   *  `outer.zip > inner.iso > folder >`, one path, every segment clickable.
   *  Each entry knows how to return to its own level. */
  trail?: { label: string; onBack: () => void }[]
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
      trail={trail}
    />
  )
}

function ArchiveInner({
  file,
  onUndoable,
  onRenameSelf,
  refreshKey,
  fullscreen,
  trail
}: {
  file: ViewerFile
  onUndoable?: (entry: UndoEntry) => void
  onRenameSelf?: (name: string) => void
  refreshKey: number
  fullscreen: boolean
  /** The archives this one is nested inside, outermost first; see ArchiveView. */
  trail?: { label: string; onBack: () => void }[]
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
  /** The panel's dead-space menu, kept apart from the row menu's state. */
  const [panelMenu, setPanelMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    void window.prism.archiveStat(file.path).then((st) => setReadOnly(!!st?.readOnly))
  }, [file.path])
  /**
   * What the HOST can do (#106). On the phone nothing writes, nothing
   * reaches the OS clipboard, nothing drags out and there is no Explorer, so
   * the panel keeps View and the folder navigation and offers none of the
   * rest. `readOnly` above is the CONTAINER's (a 7z is listed and never
   * written); `writable` is the two together, and is what every verb that
   * changes the archive itself asks. Extracting is a write to the DISK, so
   * it asks `caps.write` alone and stays on a 7z.
   */
  const caps = window.prism.capabilities
  const writable = !readOnly && caps.write
  const [cwd, setCwdRaw] = useState('')
  const [member, setMember] = useState<{ name: string; path: string; kind: FileKind } | null>(null)
  /** The member currently being extracted for viewing, if any.
   *
   *  A member is copied out of the container before it can be shown, and on a
   *  big one - the inner zip of a 3GB game rip, say - that is seconds to
   *  minutes with nothing on screen. Silence there reads as the app having
   *  hung rather than as it working, which is the same reason an extraction
   *  to disk has a window with a bar in it (#166). */
  const [opening, setOpening] = useState<string | null>(null)
  /** The member overlay, so Escape can tell whether a DEEPER one is inside it. */
  const memberBox = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry; multi?: string[] } | null>(
    null
  )
  const [editing, setEditing] = useState<string | null>(null)
  // Drag and drop (#70). dropTarget is a folder path, or '' for the panel
  // itself (meaning "this folder you are looking at").
  const [dropTarget, setDropTarget] = useState<string | null>(null)
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
  /**
   * Just finished, for about two seconds.
   *
   * The completion POPUP is gone (owner decision, 2026-08-31): a modal is a
   * lot of ceremony for "the thing you asked for happened". But a multi-minute
   * extraction that ends in silence is not much better, so the button you
   * pressed says so and then goes back to what it was. No new element, so
   * nothing moves. It still holds under the extraction window (2026-09-19,
   * #166): that window closes by itself on success and raises nothing in its
   * place, so this is still the only word said about having finished.
   */
  const [justDone, setJustDone] = useState(false)
  useEffect(() => {
    if (!justDone) return
    const t = window.setTimeout(() => setJustDone(false), 2200)
    return () => window.clearTimeout(t)
  }, [justDone])
  /**
   * The panel's own slow verbs: copying a folder to the clipboard, and adding
   * files. NOT extracting (2026-09-19, #166): an extraction puts a modal
   * window over the whole app, so there is nothing left to disable and no
   * button that needs to say "Extracting...", which is what this used to be
   * for.
   */
  const [busy, setBusy] = useState<'copy' | 'add' | null>(null)
  /** Renaming the archive itself, from the verb row. */
  const [renamingSelf, setRenamingSelf] = useState(false)
  /** The drag-select band, in the panel box's own coordinates. */
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const sysIcon = useSysIcon(file.path)

  const load = useCallback(
    (password?: string) => {
      void window.prism.archiveList(file.path, password).then((r) => {
        if (r.ok) {
          // A password that got us in belongs to the renderer's own store too,
          // so dragging a member out to a folder does not ask again.
          if (password) rememberArchivePassword(file.path, password)
          // A zip's directory records are OPTIONAL and plenty of writers
          // leave them out, which used to make such an archive read as
          // EMPTY: every member's parent was two levels down and the
          // folders those names imply did not exist to be listed.
          setEntries(withImpliedFolders(r.entries))
          return
        }
        setEntries(r.reason === 'password' ? 'locked' : 'error')
      })
    },
    [file.path]
  )
  useEffect(() => load(), [load, refreshKey])
  // The password, the taken name on the way in, the permanent delete and the
  // message box: the verbs' questions, shared with a zip in the Explorer.
  // The password lives in lib/archivePass, one per archive, so the SIDEBAR
  // can use it too when a member is dragged out to a folder (#70).
  const ops = useArchiveOps({ refresh: () => load(), noteUndo: onUndoable })
  const {
    withPassword: runWithPass,
    extract: extractOut,
    rename: renameIn,
    askDelete,
    addInto: addIn,
    moveInside,
    say: setOops
  } = ops

  // The rows of the CURRENT folder only: folders first, names ordered.
  const rows = useMemo((): Entry[] => {
    if (!entries || entries === 'error' || entries === 'locked') return []
    return entries
      .filter((e) => parentDir(e.path) === cwd)
      .sort((a, b) => (a.dir === b.dir ? naturalCompare(a.name, b.name) : a.dir ? -1 : 1))
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

  const view = useCallback(
    (entry: Entry): void => {
      setOpening(entry.name)
      runWithPass(file.path, entry.name, (pw) =>
        window.prism.archiveExtract(file.path, entry.path, pw).then((r) => {
          setOpening(null)
          if (r.ok) {
            setMember({ name: entry.name, path: r.path, kind: r.kind })
            return 'ok'
          }
          return r.reason
        })
      )
    },
    [file.path, runWithPass]
  )
  /** The archive's own folder: where "Extract here" lands a member. */
  const besideArchive = parentDir(file.path)
  /** Members OUT to a real folder (2026-09-03, owner: "Extract here" and
   *  "Extract to..." on a member row, file or folder alike). `here` lands
   *  beside the archive, inside the root; otherwise main's dialog picks,
   *  which is the consent that lets it write anywhere. The extraction
   *  window and the password question are useArchiveOps' (#166). */
  const extractMembers = useCallback(
    (entry: Entry, entries: string[], here: boolean): void =>
      extractOut(file.path, entries, entry.name, here ? besideArchive : null),
    [file.path, besideArchive, extractOut]
  )

  const copyOut = useCallback(
    (entry: Entry): void =>
      runWithPass(file.path, entry.name, (pw) =>
        window.prism.archiveExtract(file.path, entry.path, pw).then((r) => {
          if (r.ok) {
            void copyFilePaths([r.path])
            return 'ok'
          }
          return r.reason
        })
      ),
    [file.path, runWithPass]
  )
  const submitRename = useCallback(
    (entry: Entry, name: string): void => {
      setEditing(null)
      renameIn(file.path, entry.path, entry.name, name)
    },
    [file.path, renameIn]
  )
  /** Asks before deleting one member. */
  const setConfirmDel = useCallback(
    (entry: Entry): void => askDelete(file.path, [entry.path], [entry.name]),
    [file.path, askDelete]
  )
  /** Asks before deleting several; the marks go with them. */
  const setConfirmDelMany = useCallback(
    (paths: string[]): void =>
      askDelete(file.path, paths, paths.map(baseName), () => setSel(emptySelection)),
    [file.path, askDelete]
  )

  // Escape closes the member preview; Backspace climbs out of a folder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (member && e.key === 'Escape') {
        // A nested archive puts a second overlay INSIDE this one, and both
        // handlers sit on the window, so an unguarded Escape closed this level
        // and its parent at once - out of a file, out of the archive holding
        // it, in one press. Whichever overlay has no deeper one inside it is
        // the one that answers, which is the same `data-owns-escape` contract
        // App already yields on.
        if (memberBox.current?.querySelector('[data-owns-escape]')) return
        e.stopPropagation()
        setMember(null)
      } else if (!member && e.key === 'Backspace' && cwd && !editing && !ops.open) {
        const el = document.activeElement
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
        e.preventDefault()
        setCwd(parentDir(cwd))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [member, cwd, editing, ops.open, setCwd])

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
        if (out.length) void copyFilePaths(out)
        if (locked)
          setOops(
            `${locked} of the selected members are password protected. Open one first to unlock the archive, then copy again.`
          )
      })()
    },
    [file.path, rows, setOops]
  )
  /**
   * Copy a FOLDER out as a folder.
   *
   * `copyMany` extracts each member on its own and puts the loose files on
   * the clipboard, which is right for a multi-selection of files and wrong
   * for a folder: you right-clicked one thing and got a flat pile of what was
   * inside it. Main extracts the whole subtree to one temp directory with its
   * shape intact, and that directory is what goes on the clipboard.
   */
  const copyFolder = useCallback(
    (entry: string): void => {
      setBusy('copy')
      void window.prism.archiveExtractDir(file.path, entry).then((r) => {
        setBusy(null)
        if (r.ok) void copyFilePaths([r.path])
        else if (r.reason === 'password' || r.reason === 'aes')
          setOops(
            'That folder is password protected. Open a member first to unlock the archive, then copy again.'
          )
        else
          setOops(
            r.message
              ? `That folder couldn't be copied. ${r.message}`
              : "That folder couldn't be copied."
          )
      })
    },
    [file.path, setOops]
  )
  /** One folder from inside the archive, out beside the archive itself.
   *  The window, its progress and its error are all main's (#166). */
  const extractFolderHere = useCallback(
    (entry: string): void => {
      void window.prism.archiveExtractDir(file.path, entry, true).then((r) => {
        if (r.ok) setJustDone(true)
      })
    },
    [file.path]
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
  const extractAll = useCallback(
    (here = false): void => {
      // THE EXTRACTION WINDOW (2026-09-19, #166), superseding the chip this
      // ran on since 2026-09-03 and the "Extracting..." the button used to
      // read. Owner: "I would like it to just be one kind of view that
      // appears, and I want it to be a pop-up window that you can't close,
      // kind of like it is with WinRAR." Main opens it once its own folder
      // dialog is answered, feeds it, and turns it into the error when there
      // is one (7-Zip's own line included), so every route looks the same
      // because no route draws anything.
      void window.prism.archiveExtractAll(file.path, here).then((r) => {
        if (r.ok) setJustDone(true)
      })
    },
    [file.path]
  )

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
      if (isTypingTarget(el)) return
      // The keyboard went on to the Explorer's list or the tree since the
      // last press here (Tab): their own Ctrl+A answers (#330), not both.
      if (el?.closest('.browse-list,[data-project-sidebar]')) return
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
  /** Add real files to the folder you are looking at. zip only: the 7-Zip
   *  containers are read-only, and their button is not offered. */
  const addFiles = useCallback((): void => {
    setBusy('add')
    void window.prism.pickFiles().then((paths) => {
      setBusy(null)
      if (paths.length) addIn(file.path, paths, cwd, false)
    })
  }, [addIn, file.path, cwd])

  /** A drop landed inside the archive: members rearrange, real files come in. */
  const onDropInArchive = useCallback(
    (e: React.DragEvent, destFolder: string): void => {
      setDropTarget(null)
      const payload = dragPayload(e.dataTransfer)
      setDrag(null)
      if (payload?.kind === 'members')
        return moveInside(
          file.path,
          { from: payload.archive, entries: payload.entries, dest: destFolder },
          () => setSel(emptySelection)
        )
      // From the sidebar, or straight from Explorer.
      const fromPrism = payload?.kind === 'files'
      const paths = fromPrism ? payload.paths : droppedPaths(e.dataTransfer)
      if (paths.length) addIn(file.path, paths, destFolder, fromPrism)
    },
    [addIn, moveInside, file.path]
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

  /** The quiet columns are dim2, and --p-dim on a marked row: the tint is
   *  held down until --p-dim reads 3.2:1 on it (theme.ts), and dim2 was never
   *  measured there. */
  const colTone = (path: string): string =>
    sel.items.has(path) ? 'text-[var(--p-dim)]' : 'text-[var(--p-dim2)]'

  /** Every FILE member inside a folder, at any depth. A folder in a zip is a
   *  prefix, not a container, so its verbs act on what carries that prefix. */
  const under = (folder: string): string[] =>
    (entries === null || entries === 'error' || entries === 'locked' ? [] : entries)
      .filter((e) => !e.dir && (e.path === folder || e.path.startsWith(folder + '/')))
      .map((e) => e.path)

  /** Only file members can be copied out or deleted; a folder in the
   *  selection is carried by its members, and counting it made the labels
   *  promise more than the verbs could do. */
  const filesOf = (paths: string[]): string[] =>
    paths.filter((p) => rows.some((r) => r.path === p && !r.dir))
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
            <KindIcon kind="archive" color={iconColour('archive')} />
          )}
        </span>
        <div className="max-w-[36rem] truncate text-[14px] font-semibold text-[var(--p-text)]">
          {file.name}
        </div>
        <div className="mt-1 text-[11.5px] text-[var(--p-dim)]">{totals || ' '}</div>

        {/* The verbs that act on the WHOLE archive (2026-08-25). Row verbs
            stay on the right-click menu; these are the ones you come to an
            archive to do, and hunting a menu for "extract" was the gap. */}
        {/* Every one of these is a write, the OS clipboard or Explorer, so
            on the phone (#106) the row is not drawn at all: an empty row
            would be a gap where the verbs used to be. */}
        {(caps.write || caps.clipboard || caps.explorer) && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            {caps.write && (
              <ArcVerb
                label={justDone ? 'Extracted' : 'Extract here'}
                disabled={busy !== null}
                onClick={() => extractAll(true)}
                path="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14"
              />
            )}
            {caps.write && (
              <ArcVerb
                label="Extract to…"
                disabled={busy !== null}
                onClick={() => extractAll(false)}
                path="M12 4v10m0 0l-4-4m4 4l4-4M4 19h6m4 0h6"
              />
            )}
            {writable && (
              <ArcVerb
                label="Add files…"
                disabled={busy !== null}
                onClick={addFiles}
                path="M12 5v14M5 12h14"
              />
            )}
            {caps.clipboard && (
              <ArcVerb
                label="Copy"
                onClick={() => void copyFilePaths([file.path])}
                path="M9 9h10v10H9zM5 15V5h10"
              />
            )}
            {onRenameSelf && caps.write && (
              <ArcVerb
                label="Rename…"
                onClick={() => setRenamingSelf(true)}
                path="M4 20h4L19 9l-4-4L4 16z"
              />
            )}
            {caps.explorer && (
              <ArcVerb
                label="Show in Explorer"
                onClick={() => window.prism.showInExplorer(file.path)}
                path="M3 7h6l2 2h10v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"
              />
            )}
          </div>
        )}
        {/* The inline track is GONE (2026-09-03, owner): the sidebar's
            extract verb showed a popup while this panel drew a bar under the
            verbs, and two looks for the same wait read as two apps. The one
            look is the extraction window now (2026-09-19, #166,
            `ExtractWindow`), which belongs to the app and not to this panel:
            a bar, a percentage, the file being written and Cancel, leaving
            by itself when the work lands. */}
        <div className="mt-3.5 flex min-h-0 w-full max-w-[1280px] flex-1 flex-col">
          {/* The crumb row is always present, root included: the archive
                itself is the first crumb wherever you stand, so the path
                reads the same coming back as it did going in (and the panel
                never jumps a line). */}
          <div
            data-archive-crumbs
            data-archive-subfolder={cwd ? '' : undefined}
            className="mb-1 flex h-6 items-center gap-1 px-1 text-[12px]"
          >
            {trail?.map((a, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                <button
                  className="no-drag min-w-0 truncate rounded px-1 py-0.5 text-[var(--p-dim)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
                  onClick={a.onBack}
                  title={`Back to ${a.label}`}
                >
                  {a.label}
                </button>
                <span aria-hidden className="text-[var(--p-dim2)]">
                  ›
                </span>
              </span>
            ))}
            <button
              className={`no-drag rounded px-1 py-0.5 ${crumbs.length ? 'text-[var(--p-dim)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]' : 'font-semibold text-[var(--p-text)]'}`}
              onClick={() => setCwd('')}
            >
              {file.name}
            </button>
            {crumbs.length > 0 && (
              <>
                {/* Chevrons rather than slashes, and the folder you are IN in
                    full contrast and semibold (2026-08-31). It was all one
                    grey with `/` between, which read as a sentence rather than
                    as a path you can click your way back along. */}
                {crumbs.map((seg, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span aria-hidden className="text-[var(--p-dim2)]">
                      ›
                    </span>
                    <button
                      className={`no-drag rounded px-1 py-0.5 ${i < crumbs.length - 1 ? 'text-[var(--p-dim)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]' : 'font-semibold text-[var(--p-text)]'}`}
                      onClick={() => setCwd(crumbs.slice(0, i + 1).join('/'))}
                    >
                      {seg}
                    </button>
                  </span>
                ))}
              </>
            )}
            {/* And one AFTER the folder you are in (2026-08-31). Chevrons only
                BETWEEN segments read as a separator between two names; a
                trailing one is what makes the row read as a path. */}
            <span aria-hidden className="text-[var(--p-dim2)]">
              ›
            </span>
          </div>
          <div
            ref={panelBox}
            onPointerDown={onPanelPointerDown}
            // The panel's DEAD SPACE answers a right-click too (2026-08-30).
            // It already answers the pointer - a press there clears the marks
            // and a drag sweeps a band - so a right-click landing on nothing
            // read as a miss. It carries the verbs the row above does, where
            // the pointer is, plus Select all.
            onContextMenu={(e) => {
              if ((e.target as HTMLElement | null)?.closest('[data-arc-row]')) return
              e.preventDefault()
              setPanelMenu({ x: e.clientX, y: e.clientY })
            }}
            className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-[var(--p-side-flat)] ${
              dropTarget === cwd
                ? 'border-[color:var(--p-accent-hi)]'
                : 'border-[color:var(--p-divider)]'
            }`}
            {...(caps.write ? dropProps(cwd) : {})}
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
            {/* No horizontal padding: the rows run EDGE TO EDGE, so the zebra
                stripes and the selection fill reach both borders instead of
                floating as rounded tiles inside a gutter (owner pick,
                2026-08-31). The rows carry the text inset themselves, at the
                same px-4 the column header uses, so the columns still line
                up. */}
            <div data-arc-list className="min-h-0 flex-1 overflow-y-auto pb-1.5">
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
                  {rows.map((r, rowIndex) =>
                    editing === r.path ? (
                      <li key={r.path} className="px-3.5">
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
                          className={`flex h-[28px] w-full cursor-pointer items-center gap-2 px-4 text-left text-[12.5px] outline-none ${
                            dropTarget === r.path
                              ? 'bg-[var(--p-hover-hi)] text-[var(--p-text)] ring-1 ring-inset ring-[var(--p-accent-hi)]'
                              : sel.items.has(r.path)
                                ? // The tint is in `style`: a zip's list is a
                                  // file selection like the Explorer's (#257).
                                  'text-[var(--p-text-soft)]'
                                : `${rowIndex % 2 === 1 ? 'p-zebra ' : ''}text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] focus-visible:bg-[var(--p-hover)]`
                          }`}
                          style={
                            dropTarget !== r.path && sel.items.has(r.path)
                              ? markedLook({
                                  top: rowIndex > 0 && sel.items.has(rows[rowIndex - 1].path),
                                  bottom: rowIndex < rows.length - 1 && sel.items.has(rows[rowIndex + 1].path)
                                })
                              : undefined
                          }
                          // A drag out is a move or an extraction and a drop in
                          // is a write, and the phone has neither (#106).
                          draggable={caps.drag}
                          onDragStart={caps.drag ? (e) => onRowDragStart(e, r.path) : undefined}
                          onDragEnd={() => {
                            setDropTarget(null)
                            setDrag(null)
                          }}
                          {...(r.dir && caps.write ? dropProps(r.path) : {})}
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
                            } else if (!r.dir && e.key === 'F2' && writable && !fullscreen) {
                              e.preventDefault()
                              setEditing(r.path)
                            } else if (e.key === 'Delete' && writable && !fullscreen) {
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
                              // A marked row is a tint, so the icon keeps its
                              // colours, as in the tree and the Explorer; its
                              // knockouts are the tint as seen over the viewer.
                              color={iconColour(fileKind(extOf(r.name), r.name))}
                              bg={sel.items.has(r.path) ? 'var(--p-sel-tint-seen)' : undefined}
                              ext={extOf(r.name)}
                              name={r.name}
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
                className="pointer-events-none absolute rounded-[3px] border border-[color:var(--p-sel-hue-hi)]"
                style={{
                  left: band.x,
                  top: band.y,
                  width: band.w,
                  height: band.h,
                  background: 'color-mix(in srgb, var(--p-sel-hue) 22%, transparent)'
                }}
              />
            )}
          </div>
        </div>
      </div>

      {opening && !member && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[var(--p-bg)]/70">
          <div className="flex items-center gap-3 rounded-lg border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-4 py-3 text-[13px] text-[var(--p-text)]">
            <Spinner small />
            <span className="min-w-0 truncate">Opening {opening}...</span>
          </div>
        </div>
      )}
      {member && (
        <div
          ref={memberBox}
          data-owns-escape
          className="absolute inset-0 z-20 flex flex-col bg-[var(--p-bg)]"
        >
          {/*
            A header for a member that is NOT an archive - an image, a text
            file - because those viewers have no path of their own. An archive
            member gets NONE: it continues this crumb row instead, so a zip
            holding an iso reads as one path rather than as a bar above a bar.
          */}
          {member.kind !== 'archive' && (
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
              {/*
                A CRUMB, not a caption. Opening an iso inside a zip works, and
                used to leave nothing but a chevron to get back by - and with a
                second archive inside that one, no way to see where you were at
                all. Each level renders its own crumb, so they stack into the
                path: the container is a button that returns to it, the member is
                the segment you are on, and the chevron between them reads as a
                path the way the archive's own crumb row does.
              */}
              <button
                className="no-drag min-w-0 shrink-0 truncate rounded px-1 text-[var(--p-dim)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
                onClick={() => setMember(null)}
                title={`Back to ${file.name}`}
              >
                {file.name}
              </button>
              <svg
                viewBox="0 0 24 24"
                width={12}
                height={12}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-[var(--p-dim2)]"
                aria-hidden
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              <span className="min-w-0 truncate font-semibold text-[var(--p-text)]">
                {member.name}
              </span>
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            <MemberView
              name={member.name}
              path={member.path}
              kind={member.kind}
              trail={[...(trail ?? []), { label: file.name, onBack: () => setMember(null) }]}
            />
          </div>
        </div>
      )}

      {panelMenu && (
        <ContextMenu
          x={panelMenu.x}
          y={panelMenu.y}
          onClose={() => setPanelMenu(null)}
          items={archivePanelMenu({
            archivePath: file.path,
            caps,
            writable,
            busy: busy !== null,
            hasRows: rows.length > 0,
            extractAll,
            addFiles,
            selectAll: () =>
              setSel({ anchor: rows[0]?.path ?? null, items: new Set(rows.map((r) => r.path)) })
          })}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={archiveRowMenu({
            entry: menu.entry,
            multi: menu.multi,
            caps,
            writable,
            membersUnder: under,
            filesOf,
            setCwd,
            view,
            copyOut,
            copyFolder,
            copyMany,
            extractFolderHere,
            extractMembers,
            setEditing,
            setConfirmDel,
            setConfirmDelMany
          })}
          onClose={() => setMenu(null)}
        />
      )}
      {ops.dialogs}
      {renamingSelf && (
        // Renaming the archive itself. The answer goes to App, which owns
        // renaming (taken names, following the open file, the undo stack).
        <BrowseRename
          title="Rename archive"
          select="stem"
          name={file.name}
          onCancel={() => setRenamingSelf(false)}
          onSave={(v) => {
            setRenamingSelf(false)
            const next = v.trim()
            if (next && next !== file.name) onRenameSelf?.(next)
          }}
        />
      )}

    </div>
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
  return (
    <div className="flex h-[28px] items-center">
      <RenameField
        name={name}
        onSubmit={onSubmit}
        onCancel={onCancel}
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
