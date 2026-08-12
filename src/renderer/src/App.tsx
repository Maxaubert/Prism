import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { OnClash, OpenPayload, ViewerFile } from '@shared/types'
import { preloadImage } from './lib/imageLoader'
import { scopeFiles, useNavScope } from './lib/navScope'
import { sortFiles, useSort } from './lib/sortPrefs'
import { useTreeSide } from './lib/treePrefs'
import { VideoView } from './components/VideoView'
import { AudioView } from './components/AudioView'
import { ImageView } from './components/ImageView'
import { MarkdownView } from './components/MarkdownView'
import { PdfView } from './components/pdf/PdfView'
import { TextEdit } from './components/TextEdit'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { Onboarding } from './components/Onboarding'
import { ACCENT_THEME_ID } from './lib/viz/styles'
import {
  setBarTheme as setVizBarTheme,
  setCycle as setVizCycle,
  setGlow as setVizGlow,
  setMove as setVizMove,
  setTheme as setVizTheme
} from './lib/vizStore'
import { Dialog } from './components/Dialog'
import { loadTransportStyle, TRANSPORT_KEY, type TransportStyle } from './lib/transport'

// Phase 0/1 shell: a dark frameless window that opens a file (launch arg, drag,
// or dialog), routes by kind to a viewer, and pages through the folder. Video,
// audio, and image are the built "perfect" viewers; pdf/text are still stubs and
// get their own phase. All viewers eventually come from prism-core.

const PLAYABLE = new Set(['video', 'audio'])
// Documents own their vertical keys: Up/Down and PageUp/PageDown scroll or flip
// pages inside a pdf/text file instead of paging the folder. Left/Right page
// the folder everywhere.
const DOC = new Set(['pdf', 'text'])
const PRELOAD_MAX_BYTES = 80 * 1024 * 1024 // don't warm neighbours bigger than this
const SIDEBAR_KEY = 'prism.sidebar'
const RAIL_KEY = 'prism.settings.rail'
// Shown once, on the first launch, and again from Settings > About.
const SETUP_KEY = 'prism.onboarded'

/** A question Prism has to put to the user before (or instead of) touching a file. */
type Ask =
  | { kind: 'delete'; path: string; name: string; isFolder: boolean }
  | { kind: 'clash'; path: string; name: string; suggestion: string }
  | { kind: 'failed'; message: string }
  | { kind: 'discard-edit'; proceed: () => void }

function TopBar({
  name,
  pos,
  settingsOpen,
  onToggleSettings,
  panelOpen,
  onTogglePanel,
  setup,
  wash,
  editable,
  editing,
  onToggleEdit
}: {
  /** The open file's name - or '' while the sidebar is showing it, so the
   *  same fact isn't said twice on one screen. */
  name: string
  pos: string
  settingsOpen: boolean
  onToggleSettings: () => void
  /** The left-hand panel of whatever is on screen: the tree, or the rail. */
  panelOpen: boolean
  onTogglePanel: () => void
  /** First-run setup is up: the bar keeps the name and the window buttons, and
   *  drops the controls for an app you haven't met yet. */
  setup: boolean
  /** Whether the style's light reaches the bar. It follows the window: with a
   *  file on screen there is no wash anywhere. */
  wash: boolean
  /** Whether the open file takes the pencil (text kinds do). */
  editable: boolean
  editing: boolean
  onToggleEdit: () => void
}): JSX.Element {
  const w = window.prism
  return (
    // The bar changes colour on a curve rather than in a frame: during the
    // setup's mode wipe it is the one surface the still doesn't cover, and a
    // hard swap there read as a flash.
    <div
      className={`drag p-styled-font flex h-9 shrink-0 items-center gap-3 border-b border-[var(--p-divider)] bg-[var(--p-title)] px-3 text-[13px] transition-[background-color,border-color] duration-[550ms] [transition-timing-function:cubic-bezier(.16,1,.3,1)] ${wash ? 'p-wash' : ''}`}
    >
      {/* One button, one idea: collapse the panel on the left. Over Settings the
          tree isn't there, so it collapses that page's rail to its glyphs. */}
      {!setup && (
      <button
        className={`no-drag grid h-7 w-8 place-items-center rounded transition-colors hover:bg-white/10 ${
          panelOpen ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-icon)] hover:text-[var(--p-text)]'
        }`}
        onClick={onTogglePanel}
        title={settingsOpen ? 'Collapse the rail (Ctrl+B)' : 'Files (Ctrl+B)'}
        aria-label={settingsOpen ? 'Collapse the settings rail' : 'Toggle file tree'}
        aria-pressed={panelOpen}
      >
        <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      </button>
      )}
      <span className={`font-semibold text-[var(--p-accent-hi)] ${setup ? '-ml-0.5' : ''}`}>Prism</span>
      <span className="min-w-0 flex-1 truncate text-[var(--p-dim)]">{name}</span>
      {pos && <span className="text-[var(--p-dim)]">{pos}</span>}
      <div className="no-drag flex items-center gap-1">
        {!setup && editable && (
        <button
          className={`grid h-7 w-8 place-items-center rounded transition-colors hover:bg-white/10 ${
            editing ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-icon)] hover:text-[var(--p-text)]'
          }`}
          onClick={onToggleEdit}
          title={editing ? 'Stop editing' : 'Edit'}
          aria-label="Edit"
          aria-pressed={editing}
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
          </svg>
        </button>
        )}
        {!setup && (
        <button
          className={`grid h-7 w-8 place-items-center rounded transition-colors hover:bg-white/10 ${
            settingsOpen ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-icon)] hover:text-[var(--p-text)]'
          }`}
          onClick={onToggleSettings}
          title="Settings"
          aria-label="Settings"
          aria-pressed={settingsOpen}
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.64.73.83H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </button>
        )}
        <button className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]" onClick={() => w.minimize()}>–</button>
        <button className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]" onClick={() => w.toggleMaximize()}>▢</button>
        <button className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-red-500/80 hover:text-[var(--p-text)]" onClick={() => w.close()}>✕</button>
      </div>
    </div>
  )
}

const isMarkdown = (name: string): boolean => /\.(md|markdown)$/i.test(name)

function TextViewer({ path }: { path: string }): JSX.Element {
  const [text, setText] = useState<string>('')
  const box = useRef<HTMLPreElement>(null)
  useEffect(() => {
    // Guarded: paging quickly between text files reuses this component (Viewer
    // is keyed by kind), and a slow read must not land over a fast one.
    let alive = true
    void window.prism.readText(path).then((t) => alive && setText(t ?? '(could not read file)'))
    return () => {
      alive = false
    }
  }, [path])
  // Documents own their vertical keys: focused, the <pre> scrolls natively.
  useEffect(() => {
    box.current?.focus()
  }, [path])
  return (
    <pre
      ref={box}
      tabIndex={-1}
      className="h-full w-full overflow-auto p-6 font-mono text-[13px] leading-relaxed text-[var(--p-text-soft)] outline-none select-text"
    >
      {text}
    </pre>
  )
}

function Viewer({
  file,
  onToggleFullscreen,
  fullscreen,
  transportStyle,
  onOpenLocal,
  onAutoAdvance
}: {
  file: ViewerFile
  onToggleFullscreen: () => void
  fullscreen: boolean
  transportStyle: TransportStyle
  /** A markdown link to a local file; opened the same way as a tree click. */
  onOpenLocal: (path: string) => void
  /** Autoplay: a finished video/track moves to the next of its kind. */
  onAutoAdvance: () => void
}): JSX.Element {
  const url = window.prism.mediaUrl(file.path)
  switch (file.kind) {
    case 'video':
      return <VideoView url={url} path={file.path} onToggleFullscreen={onToggleFullscreen} onAutoAdvance={onAutoAdvance} transportStyle={transportStyle} />
    case 'image':
      return <ImageView url={url} name={file.name} onToggleFullscreen={onToggleFullscreen} />
    case 'audio':
      return <AudioView url={url} name={file.name} fullscreen={fullscreen} onToggleFullscreen={onToggleFullscreen} onAutoAdvance={onAutoAdvance} transportStyle={transportStyle} />
    case 'pdf':
      return <PdfView url={url} onToggleFullscreen={onToggleFullscreen} />
    case 'text':
      return isMarkdown(file.name) ? (
        <MarkdownView path={file.path} onOpenLocal={onOpenLocal} />
      ) : (
        <TextViewer path={file.path} />
      )
    default:
      return <div className="text-[var(--color-dim)]">Can&apos;t preview this file type yet.</div>
  }
}

function EmptyState({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      {/* A hairline and nothing else, so the window's own material carries
          through it. No backdrop-filter: inside a transparent window it has
          nothing behind to sample and composites as a solid fill, which is
          exactly the opaque tile this was meant to get rid of. */}
      <div className="grid h-[72px] w-[72px] place-items-center rounded-[20px] border border-[color:var(--p-line)] text-[var(--p-accent-hi)]">
        <svg viewBox="0 0 24 24" width={30} height={30} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 18a4 4 0 0 1 .6-8 5.2 5.2 0 0 1 10 1.2A3.4 3.4 0 0 1 17.5 18z" />
          <path d="M12 11v6m0 0l-2.2-2.2M12 17l2.2-2.2" />
        </svg>
      </div>
      <div className="text-lg font-semibold">Open a file to view it</div>
      <div className="text-sm text-[var(--p-dim)]">Drop a file here, or</div>
      <button className="no-drag rounded-xl bg-[var(--p-accent)] px-4 py-2 text-sm font-semibold text-[var(--p-on-accent)] hover:brightness-110" onClick={onOpen}>
        Browse…
      </button>
    </div>
  )
}

export default function App(): JSX.Element {
  // `raw` is every viewable sibling main found; `rawIndex` points at the file on
  // screen. The list the user actually pages through is derived from those two
  // plus the navigation scope, so changing the scope re-derives around the
  // current file instead of moving off it.
  const [raw, setRaw] = useState<OpenPayload | null>(null)
  const [rawIndex, setRawIndex] = useState(0)
  // Whether the user has started paging through the folder in this session. A
  // freshly opened audio/video keeps the arrow keys for seeking; once you've
  // navigated, arrows keep paging even when they land on a playable file.
  const [hasNavigated, setHasNavigated] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [transportStyle, setTransportStyle] = useState<TransportStyle>(loadTransportStyle)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Setup launches with --setup, which shows the guide even here, where it has
  // been through once already.
  const [setup, setSetup] = useState(
    () => window.prism.forceSetup === true || localStorage.getItem(SETUP_KEY) !== '1'
  )
  // The file tree. Off on a fresh install: the media is the point.
  const [sidebar, setSidebar] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1')
  const treeSide = useTreeSide()
  const toggleSidebar = useCallback(() => {
    setSidebar((on) => {
      localStorage.setItem(SIDEBAR_KEY, on ? '0' : '1')
      return !on
    })
  }, [])
  // The pencil: the raw source of a text file, editable in place. Leaving the
  // file leaves the editor; a save bumps docVersion so the viewer re-reads.
  const [editMode, setEditMode] = useState(false)
  const [docVersion, setDocVersion] = useState(0)
  // Whether the editor holds unsaved text. A ref: navigation guards read it
  // inside callbacks, and it must never be a render dependency.
  const editorDirty = useRef(false)
  const onEditorDirty = useCallback((d: boolean) => {
    editorDirty.current = d
  }, [])
  const [refreshKey, setRefreshKey] = useState(0)
  const [ask, setAsk] = useState<Ask | null>(null)

  /** Anything that would move off (or reload out of) a dirty editor goes
   *  through here: it asks first, exactly as the editor's own Escape does.
   *  TextEdit guards its own exits; this guards everyone else's. */
  const guardEdit = useCallback(
    (proceed: () => void): void => {
      if (editMode && editorDirty.current) setAsk({ kind: 'discard-edit', proceed })
      else proceed()
    },
    [editMode]
  )
  // Settings covers the tree, so over it the same control collapses that page's
  // rail instead: one button, one idea - narrow the panel on the left.
  const [compactRail, setCompactRail] = useState(() => localStorage.getItem(RAIL_KEY) === '1')
  const toggleRail = useCallback(() => {
    setCompactRail((on) => {
      localStorage.setItem(RAIL_KEY, on ? '0' : '1')
      return !on
    })
  }, [])
  const togglePanel = useCallback(() => {
    if (settingsOpen) toggleRail()
    else toggleSidebar()
  }, [settingsOpen, toggleRail, toggleSidebar])
  const pickTransport = useCallback((s: TransportStyle) => {
    setTransportStyle(s)
    localStorage.setItem(TRANSPORT_KEY, s)
  }, [])

  const open = useCallback((p: OpenPayload | null) => {
    if (p && p.files.length) {
      setRaw(p)
      setRawIndex(Math.max(0, Math.min(p.files.length - 1, p.index)))
      setHasNavigated(false) // a fresh open starts in "opened directly" mode
    }
  }, [])

  useEffect(() => window.prism.onOpenFile(open), [open])
  useEffect(() => window.prism.onFullscreen(setFullscreen), [])

  const browse = useCallback(() => void window.prism.openDialog().then(open), [open])
  // A click in the tree: the folder it lives in becomes the paging list, the
  // root stays where it was, so the tree doesn't move under you.
  const openFromTree = useCallback(
    (p: string) => guardEdit(() => void window.prism.openWithin(p).then(open)),
    [open, guardEdit]
  )

  const toggleFullscreen = useCallback(() => window.prism.setFullscreen(!fullscreen), [fullscreen])

  // The visible list: the siblings that belong with the open file under the
  // current scope, in the chosen order, and its position among them. Sorting
  // reuses the same file objects, so mapping back to rawIndex keeps working.
  const scope = useNavScope()
  const sort = useSort()
  const view = useMemo(() => {
    if (!raw) return null
    const ordered = sortFiles(raw.files, sort.field, sort.dir)
    return scopeFiles(ordered, ordered.indexOf(raw.files[rawIndex]), scope)
  }, [raw, rawIndex, scope, sort])

  const go = useCallback(
    (delta: number) => {
      if (!raw || !view) return
      const next = Math.max(0, Math.min(view.files.length - 1, view.index + delta))
      if (next === view.index) return // already at the edge; not a navigation
      guardEdit(() => {
        setRawIndex(raw.files.indexOf(view.files[next]))
        setHasNavigated(true)
      })
    },
    [raw, view, guardEdit]
  )

  const file = view?.files[view.index] ?? null

  // Autoplay's landing: the next file of the SAME kind, however many images or
  // documents sit between - a folder of episodes plays like a season, whatever
  // else lives beside them. Stops quietly at the end of the folder.
  const advanceSameKind = useCallback(() => {
    if (!raw || !view) return
    const current = view.files[view.index]
    if (!current) return
    for (let i = view.index + 1; i < view.files.length; i += 1) {
      if (view.files[i].kind === current.kind) {
        setRawIndex(raw.files.indexOf(view.files[i]))
        return
      }
    }
  }, [raw, view])

  // A different file closes the editor (render-phase adjustment, the sidebar's
  // pattern): the pencil applies to what you were looking at, not what's next.
  const [editedPath, setEditedPath] = useState<string | null>(null)
  if ((file?.path ?? null) !== editedPath) {
    setEditedPath(file?.path ?? null)
    setEditMode(false)
  }

  /* ---------- file operations ---------- */

  // Renaming, deleting, duplicating and the editor's save are the things Prism
  // does that change your files; the destructive ones are confirmable, and
  // nothing is destroyed: an overwritten or deleted file goes to the Recycle
  // Bin. (`refreshKey` and `ask` are declared above, with the edit guard.)

  /** True when `p` is `parent` itself or sits inside it. Renaming or binning a
   *  folder moves everything under it, including possibly the open file. */
  const within = (p: string, parent: string): boolean => {
    const a = p.toLowerCase()
    const b = parent.toLowerCase()
    return a === b || a.startsWith(b + String.fromCharCode(92)) || a.startsWith(b + '/')
  }

  const reopen = useCallback(
    (p: string) => void window.prism.openWithin(p).then((payload) => payload && open(payload)),
    [open]
  )

  const runRename = useCallback(
    async (path: string, name: string, onClash: OnClash): Promise<void> => {
      const r = await window.prism.renameFile(path, name, onClash)
      if (!r.ok) {
        if (r.reason === 'clash') setAsk({ kind: 'clash', path, name, suggestion: r.suggestion ?? name })
        else setAsk({ kind: 'failed', message: r.message ?? 'That could not be renamed.' })
        return
      }
      setAsk(null)
      setRefreshKey((n) => n + 1)
      // Follow whatever is on screen: it may have been the thing renamed, or a
      // file inside the folder that was, in which case its path just moved.
      const cur = file?.path
      if (!cur) return
      if (within(cur, path)) reopen(r.path + cur.slice(path.length))
      else reopen(cur)
    },
    [file, reopen]
  )

  const runDelete = useCallback(
    async (path: string): Promise<void> => {
      setAsk(null)
      const ok = await window.prism.trashFile(path)
      if (!ok) {
        setAsk({ kind: 'failed', message: 'That could not be moved to the Recycle Bin.' })
        return
      }
      setRefreshKey((n) => n + 1)
      const cur = file?.path
      if (!cur || !within(cur, path)) {
        if (cur) reopen(cur)
        return
      }
      // What we were looking at is gone. Step to the nearest surviving neighbour,
      // skipping anything that lived inside the same folder.
      const survivors = view?.files.filter((f) => !within(f.path, path)) ?? []
      const next = survivors[Math.min(view?.index ?? 0, survivors.length - 1)]
      if (next) reopen(next.path)
      else setRaw(null)
    },
    [file, reopen, view]
  )

  // App-level keys, in the capture phase so this runs before the player's own
  // (bubble-phase) key listener. Arrow keys page through the folder, except a
  // freshly opened audio/video owns them for seeking (the player handles them).
  // The moment the user starts navigating — paging, or arrowing through
  // non-playable files — arrows keep navigating even on playable files; we then
  // claim the key (preventDefault) so the player yields it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      // The setup owns the window while it is up: none of these should reach the
      // app behind it, least of all Escape, which would close Prism mid-guide.
      if (setup) return
      if (e.key === 'F11') {
        e.preventDefault()
        window.prism.setFullscreen(!fullscreen)
      } else if ((e.code === 'KeyB' || e.key === 'b' || e.key === 'B') && e.ctrlKey && !typing) {
        e.preventDefault()
        togglePanel()
      } else if (e.key === 'Escape') {
        // Settings owns Escape while it's open (its own handler closes it).
        // Without this, the window would shut instead: both listeners are on
        // window in the capture phase, and this one was registered first.
        if (settingsOpen) return
        // So does anything transient that closes itself on Escape (the PDF find
        // bar, an open menu) and any focused input: this listener runs first
        // (capture, registered earliest), so it has to yield by inspection.
        if (typing || document.querySelector('[data-owns-escape]')) return
        if (fullscreen) window.prism.setFullscreen(false)
        else window.prism.close()
      } else if (e.key === 'PageDown' || e.key === 'PageUp') {
        // Inside a document these keys belong to the document (the pdf viewer
        // flips pages; a focused text scroller scrolls natively).
        if (file && DOC.has(file.kind)) return
        go(e.key === 'PageDown' ? 1 : -1)
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing) {
        // Up and down page the folder, except inside a document, where they
        // scroll it (the viewers keep their scrollers focused for exactly this).
        if (file && DOC.has(file.kind)) return
        e.preventDefault()
        go(e.key === 'ArrowDown' ? 1 : -1)
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !typing) {
        const playerOwnsArrows = !!file && PLAYABLE.has(file.kind) && !hasNavigated
        if (!playerOwnsArrows) {
          e.preventDefault() // player checks defaultPrevented and yields
          go(e.key === 'ArrowRight' ? 1 : -1)
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [file, fullscreen, go, hasNavigated, settingsOpen, setup, togglePanel])

  // Warm the immediate neighbours (images only) so arrowing to them is instant.
  // The shared image cache holds them (and enforces the memory policy), so we just
  // fire the requests; ±1 is enough to make stepping feel seamless. Very large
  // files are skipped: warming one costs more (memory, decode jank) than it saves.
  useEffect(() => {
    if (!view) return
    // Wait for idle before warming neighbours. Load time is dominated by reading
    // the file, so firing these immediately makes two big neighbours compete with
    // the image the user is actually waiting for.
    const start = (): void => {
      for (const d of [-1, 1]) {
        const n = view.files[view.index + d]
        if (n && n.kind === 'image' && n.size <= PRELOAD_MAX_BYTES) {
          preloadImage(window.prism.mediaUrl(n.path))
        }
      }
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(start, { timeout: 1500 })
      return () => cancelIdleCallback(id)
    }
    const t = setTimeout(start, 400)
    return () => clearTimeout(t)
  }, [view])

  // Drag-and-drop (path via webUtils, since Electron removed File.path).
  useEffect(() => {
    const over = (e: DragEvent): void => {
      e.preventDefault()
      if (!setup) setDragging(true)
    }
    const leave = (): void => setDragging(false)
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(false)
      if (setup) return
      const f = e.dataTransfer?.files?.[0]
      if (f) void window.prism.openPath(window.prism.getDroppedPath(f)).then(open)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [open, setup])

  // The style's light belongs to an empty window, a visualizer, or a page of
  // Prism's own - never behind someone's photo.
  const washed = settingsOpen || setup || !file || file.kind === 'audio'

  const many = (view?.files.length ?? 0) > 1
  const pos = many ? `${view!.index + 1} / ${view!.files.length}` : ''

  // Fullscreen is for watching, not browsing: no tree, no arrows, no chrome.
  // Outside fullscreen the panel stays mounted even when closed, so it can slide.
  return (
    <div className="flex h-full flex-col text-[var(--p-text)] [font-size:var(--p-size)]">
      {!fullscreen && (
        <TopBar
          // The tree already names (and highlights) the open file; the bar only
          // repeats it when the tree isn't there to say it.
          name={sidebar && raw && !settingsOpen ? '' : (file?.name ?? '')}
          pos={pos}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((v) => !v)}
          panelOpen={settingsOpen ? !compactRail : sidebar}
          onTogglePanel={togglePanel}
          setup={setup}
          wash={washed}
          editable={file?.kind === 'text'}
          editing={editMode}
          onToggleEdit={() => setEditMode((v) => !v)}
        />
      )}
      {/* Settings covers this area. Hiding it (rather than leaving it painted
          underneath) is what lets a translucent style show its material through
          the settings page; `invisible` keeps a playing video alive. */}
      <div
        inert={settingsOpen || setup}
        className={`flex min-h-0 flex-1 ${treeSide === 'right' ? 'flex-row-reverse' : ''} ${
          settingsOpen || setup ? 'invisible' : ''
        }`}
      >
        {raw && !fullscreen && (
          <Sidebar
            open={sidebar}
            root={raw.root}
            currentPath={file?.path ?? null}
            refreshKey={refreshKey}
            onOpenFile={openFromTree}
            // Renaming or binning the edited file (or a folder over it) would
            // silently drop the editor's unsaved text; those ask first too.
            onRename={(p, name) => {
              const run = (): void => void runRename(p, name, 'ask')
              if (file && within(file.path, p)) guardEdit(run)
              else run()
            }}
            onDelete={(path, name, isFolder) => {
              const show = (): void => setAsk({ kind: 'delete', path, name, isFolder })
              if (file && within(file.path, path)) guardEdit(show)
              else show()
            }}
            wash={washed}
          />
        )}
        <div
          className={`group relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-[var(--p-bg)] ${
            washed ? 'p-wash' : ''
          } ${dragging ? 'ring-2 ring-inset ring-[var(--p-accent)]' : ''}`}
        >
          {/* Keyed by KIND, not by path. Keying by path remounted the viewer on
              every arrow press, which threw the current picture away before the
              next one had decoded and flashed the window black between them.
              A viewer keeps itself in order across files of its own kind; only
              a change of kind needs a fresh one. */}
          {file && editMode && file.kind === 'text' ? (
            <TextEdit
              path={file.path}
              onClose={() => setEditMode(false)}
              onSaved={() => {
                setEditMode(false)
                setDocVersion((v) => v + 1) // the viewer re-reads what was saved
              }}
              onDirtyChange={onEditorDirty}
            />
          ) : file ? (
            <Viewer key={`${file.kind}:${docVersion}`} file={file} onToggleFullscreen={toggleFullscreen} fullscreen={fullscreen} transportStyle={transportStyle} onOpenLocal={openFromTree} onAutoAdvance={advanceSameKind} />
          ) : (
            <EmptyState onOpen={browse} />
          )}
          {/* No on-screen arrows: paging is the keyboard's job. Left and right,
              up and down, PageUp and PageDown, in or out of fullscreen. */}
        </div>
      </div>
      <Settings
        open={settingsOpen}
        onShowSetup={() => {
          setSettingsOpen(false)
          setSetup(true)
        }}
        compactRail={compactRail}
        onClose={() => setSettingsOpen(false)}
        transportStyle={transportStyle}
        onPickTransport={pickTransport}
      />

      {ask?.kind === 'delete' && (
        <Dialog
          title="Move to the Recycle Bin?"
          body={
            <>
              <span className="text-[#d7dae1]">{ask.name}</span> goes to the Recycle Bin, where Windows can put it back.
            </>
          }
          onCancel={() => setAsk(null)}
          choices={[
            { label: 'Cancel', onPick: () => setAsk(null) },
            { label: 'Delete', danger: true, primary: true, onPick: () => void runDelete(ask.path) }
          ]}
        />
      )}

      {ask?.kind === 'clash' && (
        <Dialog
          title="That name is taken"
          body={
            <>
              This folder already has a <span className="text-[#d7dae1]">{ask.name}</span>. Keeping both saves yours as{' '}
              <span className="text-[#d7dae1]">{ask.suggestion}</span>; replacing it sends the old one to the Recycle Bin.
            </>
          }
          onCancel={() => setAsk(null)}
          choices={[
            { label: 'Cancel', onPick: () => setAsk(null) },
            { label: 'Replace', danger: true, onPick: () => void runRename(ask.path, ask.name, 'overwrite') },
            { label: 'Keep both', primary: true, onPick: () => void runRename(ask.path, ask.name, 'keep-both') }
          ]}
        />
      )}

      {ask?.kind === 'discard-edit' && (
        <Dialog
          title="Discard your changes?"
          body="Leaving this file drops what you typed in the editor; the file keeps what it had."
          onCancel={() => setAsk(null)}
          choices={[
            { label: 'Keep editing', onPick: () => setAsk(null) },
            {
              label: 'Discard',
              danger: true,
              primary: true,
              onPick: () => {
                const go = ask.proceed
                editorDirty.current = false
                setEditMode(false)
                setAsk(null)
                go()
              }
            }
          ]}
        />
      )}

      {ask?.kind === 'failed' && (
        <Dialog
          title="That didn't work"
          body={ask.message}
          onCancel={() => setAsk(null)}
          choices={[{ label: 'OK', primary: true, onPick: () => setAsk(null) }]}
        />
      )}
      {setup && (
        <Onboarding
          onDone={() => {
            localStorage.setItem(SETUP_KEY, '1')
            // The colour you picked is the colour the visualizer plays in:
            // that one accent, lit, rather than a spectrum sweeping past.
            setVizTheme(ACCENT_THEME_ID)
            setVizBarTheme(ACCENT_THEME_ID)
            setVizGlow(true)
            setVizCycle(false)
            setVizMove(false)
            setSetup(false)
          }}
        />
      )}
    </div>
  )
}
