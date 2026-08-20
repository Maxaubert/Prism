import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { OnClash, OpenPayload, ViewerFile } from '@shared/types'
import { preloadImage } from './lib/imageLoader'
import { addTab, closeTab, receiveFile, rerootTab, sameRoot, setTabTerm, splitTermView, toggleTermView, type TabState, type TreeState } from './lib/tabs'
import { dockAxis, dockFlex, loadDock, loadTermSize, saveDock, saveTermSize, type DockEdge } from './lib/termDock'
import { savedShellId } from './lib/termPrefs'
import { confirmCloseTabs } from './lib/tabPrefs'
import { TermDock } from './components/TermDock'
import { sortFiles, useSort } from './lib/sortPrefs'
import { useTreeSide } from './lib/treePrefs'
import { VideoView } from './components/VideoView'
import { AudioView } from './components/AudioView'
import { ImageView } from './components/ImageView'
import { MarkdownView } from './components/MarkdownView'
import { PdfView } from './components/pdf/PdfView'
// CodeMirror is ~770KB of editor that a folder of photos never needs. Splitting
// it out keeps it off the launch path, which is the whole point of the resident
// single-instance model: the window has to be there the instant you ask.
const CodeView = lazy(() => import('./components/CodeView').then((m) => ({ default: m.CodeView })))
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { TabStrip } from './components/TabStrip'
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

// Tab ids only have to be unique within a session and stable while a tab lives:
// they are React keys and the handle every tab action names, never anything
// persisted. A counter is enough and, unlike a path, survives a rename.
let tabSeq = 0
const nextTabId = (): string => `tab-${(tabSeq += 1)}`
let termSeq = 0
const nextTermId = (): string => `term-${(termSeq += 1)}`

/** The renderer half of ending a shell. Lazy: if a session exists, the chunk
 *  that owns the store is already loaded, so this import is always a cache hit. */
const disposeSession = (id: string): void => {
  void import('./components/TerminalPanel').then((m) => m.disposeTermSession(id))
}

// Phase 0/1 shell: a dark frameless window that opens a file (launch arg, drag,
// or dialog), routes by kind to a viewer, and pages through the folder. Video,
// audio, and image are the built "perfect" viewers; pdf/text are still stubs and
// get their own phase. All viewers eventually come from prism-core.

const PLAYABLE = new Set(['video', 'audio'])
// There is deliberately no DOC kind-set here any more. Which keys a document
// owns is a question about FOCUS, not about file kind: a pdf nobody has clicked
// into has no more claim on Up/Down than a photo does. See docFocused().
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
  | { kind: 'close-dirty' }
  // Closing a TAB whose root holds unsaved text. Same three answers as the
  // window's, because the stake is the same: leave that tab and the only route
  // back to those buffers is gone, even though the window stays open.
  | { kind: 'close-tab'; id: string; names: readonly string[] }
  // The plain "sure?" for a clean tab, on by default and switchable in
  // Settings. Dirty tabs take the unsaved-changes question above instead.
  | { kind: 'close-tab-confirm'; id: string; label: string }
  // Pointing a tab at a different folder strands its unsaved text exactly as
  // closing it would, so it asks the same question and carries the payload it
  // will apply on the way through.
  | { kind: 'reroot'; id: string; names: readonly string[]; payload: OpenPayload }

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
  dirty,
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
  /** Whether the open file takes the pencil (only markdown does). */
  editable: boolean
  editing: boolean
  /** The open buffer holds unsaved text: the bar says so with a dot. */
  dirty: boolean
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
      {/* Unsaved work is the one thing the bar interrupts itself to say. The
          tree names the file, so the dot goes where the eye already is. */}
      {dirty && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--p-accent-hi)]"
          title="Unsaved changes (Ctrl+S)"
          aria-label="Unsaved changes"
        />
      )}
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

// The one kind with two faces: markdown renders, and the pencil shows its
// source. Every other text file is only ever itself, so it needs no toggle.
const isMarkdown = (name: string): boolean => /\.(md|markdown)$/i.test(name)

/** The last segment of a path, either separator. */
const baseName = (p: string): string => /[^\\/]*$/.exec(p)?.[0] ?? p

/** While the editor chunk arrives. `delayed-loader` keeps it invisible unless
 *  the wait is long enough to notice, so a warm cache shows nothing at all. */
function EditorLoading(): JSX.Element {
  return (
    <div className="delayed-loader grid h-full w-full place-items-center">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[color:var(--p-divider)] border-t-[var(--color-accent-hi)]" />
    </div>
  )
}

function Viewer({
  file,
  onToggleFullscreen,
  fullscreen,
  transportStyle,
  onOpenLocal,
  onAutoAdvance,
  onBuffer,
  getPending
}: {
  file: ViewerFile
  onToggleFullscreen: () => void
  fullscreen: boolean
  transportStyle: TransportStyle
  /** A markdown link to a local file; opened the same way as a tree click. */
  onOpenLocal: (path: string) => void
  /** Autoplay: a finished video/track moves to the next of its kind. */
  onAutoAdvance: () => void
  /** Code and text edit in place, so the viewer hands its buffer up to App. */
  onBuffer: (path: string, text: string | null) => void
  /** Asked for the unsaved text of a file, if App is holding any. */
  getPending: (path: string) => string | undefined
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
      // Markdown is a document until the pencil says otherwise; everything else
      // is its own source, editable where it sits. A save here changes nothing
      // on screen that isn't already there, so it must not remount the viewer.
      return isMarkdown(file.name) ? (
        <MarkdownView path={file.path} onOpenLocal={onOpenLocal} />
      ) : (
        <Suspense fallback={<EditorLoading />}>
          <CodeView
            path={file.path}
            name={file.name}
            onSaved={() => {}}
            onBuffer={onBuffer}
            getPending={getPending}
          />
        </Suspense>
      )
    default:
      return <div className="text-[var(--color-dim)]">Can&apos;t preview this file type yet.</div>
  }
}

function EmptyState({ onOpen, onOpenFolder }: { onOpen: () => void; onOpenFolder: () => void }): JSX.Element {
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
      <div className="text-lg font-semibold">Open a file or folder to view it</div>
      <div className="text-sm text-[var(--p-dim)]">Drop a file here, or</div>
      <div className="flex items-center gap-2">
        <button className="no-drag rounded-xl bg-[var(--p-accent)] px-4 py-2 text-sm font-semibold text-[var(--p-on-accent)] hover:brightness-110" onClick={onOpen}>
          Open file…
        </button>
        <button
          className="no-drag rounded-xl border border-[color:var(--p-line)] px-4 py-2 text-sm font-semibold text-[var(--p-text)] transition-colors hover:border-[color:var(--p-accent-hi)]"
          onClick={onOpenFolder}
        >
          Open folder…
        </button>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  // The open projects. A tab carries every viewable sibling main found for its
  // root and which of them is on screen; `active` is the one you are looking at.
  // The list the user actually pages through is derived from those plus the
  // navigation scope, so changing the scope re-derives around the current file
  // instead of moving off it.
  // One piece of state, not two: every tab action is a pure function of the
  // whole thing, so each handler below is a plain updater and stays stable for
  // the life of the window. `open` in particular is handed to main once, through
  // onOpenFile, and must not be rebuilt whenever a tab changes.
  const [tabState, setTabState] = useState<TabState>({ tabs: [], activeId: null })
  const { tabs, activeId } = tabState
  const active = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId])
  const rawIndex = active?.index ?? -1
  /** Point the active tab at another of its files. */
  const setRawIndex = useCallback(
    (i: number) =>
      setTabState((s) => ({
        ...s,
        tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, index: i } : t))
      })),
    []
  )
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
  // The pencil: markdown's raw source, the one text kind with a rendered form
  // to toggle away from. Leaving the file leaves the editor; a save bumps
  // docVersion so the rendered view re-reads what was written.
  const [editMode, setEditMode] = useState(false)
  const [docVersion, setDocVersion] = useState(0)
  // Unsaved text lives HERE, keyed by path, not inside the editor. That is what
  // lets you edit a file, look at three others, come back, and find your edits
  // still sitting there - and it is why leaving a file now asks nothing. Only
  // closing the window can actually destroy any of it, so only closing asks.
  // Keyed case-insensitively, as Windows paths are, but keeping the real path:
  // that is what gets written, and what the tree matches its rows against.
  const buffers = useRef(new Map<string, { path: string; text: string }>())
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(new Set())
  // The names as they are actually spelled. dirtyPaths is lowercased for
  // matching, which is no way to address someone's file in a dialog.
  const [unsavedNames, setUnsavedNames] = useState<readonly string[]>([])
  const syncDirty = useCallback(() => {
    setDirtyPaths(new Set(buffers.current.keys()))
    setUnsavedNames([...buffers.current.values()].map((b) => baseName(b.path)))
    // Main needs this too: it is what holds the window open on a close.
    window.prism.setDirty(buffers.current.size > 0)
  }, [])
  /** What the editor should show for a file: unsaved text if we kept any. */
  const getPending = useCallback((p: string) => buffers.current.get(p.toLowerCase())?.text, [])
  /** The editor reports its buffer as it changes; null once it matches disk. */
  const onBuffer = useCallback(
    (path: string, text: string | null) => {
      const key = path.toLowerCase()
      if (text === null) buffers.current.delete(key)
      else buffers.current.set(key, { path, text })
      syncDirty()
    },
    [syncDirty]
  )
  /** The tree's arrow keys, lent up by Sidebar. Null while there is no tree to
   *  drive (panel shut, search showing); App then pages the folder itself. */
  const treeNav = useRef<((dir: 'up' | 'down' | 'left' | 'right') => boolean) | null>(null)
  const onNav = useCallback((step: typeof treeNav.current) => {
    treeNav.current = step
  }, [])
  /** Write every unsaved buffer. Returns the paths that could not be written,
   *  so a failing disk cancels the close instead of eating the work. */
  const saveAll = useCallback(async (): Promise<string[]> => {
    const failed: string[] = []
    for (const [key, buf] of [...buffers.current]) {
      if (await window.prism.writeText(buf.path, buf.text)) buffers.current.delete(key)
      else failed.push(buf.path)
    }
    syncDirty()
    return failed
  }, [syncDirty])
  const [refreshKey, setRefreshKey] = useState(0)
  const [ask, setAsk] = useState<Ask | null>(null)

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

  /**
   * A file or folder arriving from outside: argv, the second-instance handoff,
   * a drop, or either dialog. `receiveFile` decides where it lands - a tab whose
   * root already holds it, a new tab, or the empty window - and index -1 is a
   * folder that holds nothing viewable, which still opens as a place to browse
   * from rather than a refusal.
   */
  const open = useCallback((p: OpenPayload | null) => {
    if (!p) return
    setTabState((s) => receiveFile(s.tabs, p, nextTabId()))
    setHasNavigated(false) // a fresh open starts in "opened directly" mode
  }, [])

  // Tell main what is open, whenever it changes: persistence for next launch.
  // The root wall is deliberately NOT rebuilt from this snapshot. A report
  // races payloads still in flight (a restore, plus a file Explorer just
  // opened), and replacing the set once tore out a root main had registered
  // for a tab this renderer had not built yet - whose listDir was refused and
  // cached as "can't read this folder". Instead the wall shrinks only by
  // explicit drops: a root that stopped being held by ANY tab. A diff against
  // what we last held cannot remove what we never knew about.
  const heldRoots = useRef<readonly string[]>([])
  const hadTabs = useRef(false)
  useEffect(() => {
    const now = tabs.map((t) => t.root)
    for (const was of heldRoots.current) {
      if (!now.some((r) => sameRoot(r, was))) window.prism.dropRoot(was)
    }
    heldRoots.current = now
    // Mount says nothing (there is nothing to persist and no root to drop);
    // once a tab has existed, an empty list is real news: the last tab closed.
    if (tabs.length) hadTabs.current = true
    else if (!hadTabs.current) return
    window.prism.tabsChanged(
      tabs.map((t) => ({ root: t.root, file: t.files[t.index]?.path })),
      Math.max(0, tabs.findIndex((t) => t.id === activeId))
    )
  }, [tabs, activeId])

  useEffect(() => window.prism.onOpenFile(open), [open])
  useEffect(() => window.prism.onFullscreen(setFullscreen), [])
  // Main held the window open because the editor is dirty; ask, then answer it.
  useEffect(() => window.prism.onAskClose(() => setAsk({ kind: 'close-dirty' })), [])

  const browse = useCallback(() => void window.prism.openDialog().then(open), [open])
  /**
   * A new tab, immediately. No dialog: the + and Ctrl+T are meant to be instant,
   * so a tab arrives rooted at the user's own folder and you browse from there.
   * Choosing a folder is the sidebar's button, which changes THIS tab.
   *
   * It spawns unconditionally, unlike an arriving file: pressing + and watching
   * nothing happen because that root was already open would be worse than two
   * tabs on one folder.
   */
  const newTab = useCallback(() => {
    void window.prism.openHome().then((p) => {
      if (!p) return
      setTabState((s) => addTab(s.tabs, p, nextTabId()))
      setHasNavigated(false)
    })
  }, [])


  /** Close one tab. The last one leaves an empty window rather than taking the
   *  window with it: Prism is resident, and a window that vanishes under a
   *  reflex keystroke is the failure this app has been careful to avoid. */
  const forceCloseTab = useCallback((id: string) => {
    setTabState((s) => {
      // The tab's shell dies with it, both halves: main's pty and the
      // renderer's xterm instance.
      const tab = s.tabs.find((t) => t.id === id)
      if (tab?.term) {
        window.prism.termKill(tab.term.id)
        disposeSession(tab.term.id)
      }
      return closeTab(s.tabs, id, s.activeId)
    })
  }, [])
  /** Unsaved buffers living under a tab's root, as their names are spelled. */
  const dirtyUnder = useCallback((root: string): string[] => {
    const r = root.toLowerCase()
    return [...buffers.current.values()]
      .filter((b) => b.path.toLowerCase().startsWith(r))
      .map((b) => baseName(b.path))
  }, [])
  const applyReroot = useCallback((id: string | null, p: OpenPayload) => {
    setTabState((s) => rerootTab(s.tabs, id, p, nextTabId()))
    setHasNavigated(false)
  }, [])
  /**
   * The sidebar's folder button: this tab becomes that folder, rather than a new
   * tab beside it. The strip's `+` is the one that accumulates.
   *
   * It asks first when the tab holds unsaved text, because the consequence is
   * the close-a-tab consequence: the route back to those buffers goes with the
   * root. A folder already open in another tab switches there instead, so the
   * one-tab-per-root rule the arriving-file logic leans on still holds.
   */
  const rerootHere = useCallback(() => {
    void window.prism.openFolder().then((p) => {
      if (!p) return
      const here = tabs.find((t) => t.id === activeId)
      const names = here && !sameRoot(here.root, p.root) ? dirtyUnder(here.root) : []
      if (names.length && activeId) setAsk({ kind: 'reroot', id: activeId, names, payload: p })
      else applyReroot(activeId, p)
    })
  }, [activeId, applyReroot, dirtyUnder, tabs])
  /** Close a tab, asking first when that would strand unsaved text. */
  const closeOneTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return
      const names = dirtyUnder(tab.root)
      if (names.length) setAsk({ kind: 'close-tab', id, names })
      else if (confirmCloseTabs())
        setAsk({
          kind: 'close-tab-confirm',
          id,
          label: tab.root.split(/[\/]/).filter(Boolean).pop() ?? tab.root
        })
      else forceCloseTab(id)
    },
    [dirtyUnder, forceCloseTab, tabs]
  )
  const closeActiveTab = useCallback(() => {
    if (activeId) closeOneTab(activeId)
  }, [activeId, closeOneTab])
  const pickTab = useCallback((id: string) => setTabState((s) => ({ ...s, activeId: id })), [])

  /* ----- the terminal ----- */

  const [dockEdge, setDockEdge] = useState<DockEdge>(loadDock)
  const [termSizes, setTermSizes] = useState(() => ({ x: loadTermSize('x'), y: loadTermSize('y') }))
  const pickDock = useCallback((edge: DockEdge) => {
    setDockEdge(edge)
    saveDock(edge)
  }, [])
  const resizeTermPanel = useCallback(
    (px: number) => {
      const axis = dockAxis(dockEdge)
      setTermSizes((s) => ({ ...s, [axis]: px }))
      saveTermSize(axis, px)
    },
    [dockEdge]
  )
  /** Apply a term-view transition to the active tab, spawning ids as needed.
   *  The shell itself only dies to exit, tab close, or quit. */
  const applyTermView = useCallback(
    (fn: typeof toggleTermView) =>
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === s.activeId)
        if (!tab) return s
        return { ...s, tabs: setTabTerm(s.tabs, tab.id, fn(tab.term, nextTermId())) }
      }),
    []
  )
  /** The sidebar button and Ctrl+`: full view, the terminal's home. */
  const toggleTerm = useCallback(() => applyTermView(toggleTermView), [applyTermView])
  /** Ctrl+Shift+T: open full, unconditionally (never hides). */
  const openTermFull = useCallback(
    () => applyTermView((term, id) => (term ? { ...term, view: 'full' } : { id, view: 'full' })),
    [applyTermView]
  )
  /** Ctrl+D on a file, and the tree's "Open in split view". */
  const toggleTermSplit = useCallback(() => applyTermView(splitTermView), [applyTermView])
  // The shell ended: typed exit, or died. App owns this rather than the panel,
  // because it must be heard even while the panel is hidden or another tab is
  // in front - the tab's term slot has to clear either way.
  useEffect(
    () =>
      window.prism.onTermExit((id) => {
        disposeSession(id)
        setTabState((s) => {
          const tab = s.tabs.find((t) => t.term?.id === id)
          return tab ? { ...s, tabs: setTabTerm(s.tabs, tab.id, null) } : s
        })
      }),
    []
  )
  /** Step the active tab by `delta`, wrapping, so Ctrl+Tab cycles. */
  const stepTab = useCallback((delta: number) => {
    setTabState((s) => {
      if (s.tabs.length < 2) return s
      const i = s.tabs.findIndex((t) => t.id === s.activeId)
      return { ...s, activeId: s.tabs[(i + delta + s.tabs.length) % s.tabs.length].id }
    })
  }, [])
  /** Jump to the nth tab, 1-based, for Ctrl+1..Ctrl+9. */
  const jumpTab = useCallback((n: number) => {
    setTabState((s) => (s.tabs[n - 1] ? { ...s, activeId: s.tabs[n - 1].id } : s))
  }, [])
  /**
   * The sidebar's tree state belongs to the tab, so switching back to one shows
   * the folders you left open rather than a collapsed tree.
   *
   * It takes an updater rather than a value: Sidebar cannot hold the current
   * state (it does not own it any more), and the owner applying the update is
   * the only version of this that stays stable. An update that changes nothing
   * returns the same object, so a cached folder cannot re-render its way into a
   * loop through the effect that loads it.
   */
  const setTree = useCallback((id: string, update: (t: TreeState) => TreeState) => {
    setTabState((s) => {
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return s
      const tree = update(tab.tree)
      if (tree === tab.tree) return s
      return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, tree } : t)) }
    })
  }, [])
  /** Bound to the active tab, so Sidebar's handle is stable within a tab. */
  const onTree = useCallback(
    (update: (t: TreeState) => TreeState) => activeId && setTree(activeId, update),
    [activeId, setTree]
  )
  // A click in the tree: the folder it lives in becomes the paging list, the
  // root stays where it was, so the tree doesn't move under you.
  const openFromTree = useCallback(
    // No guard: unsaved text is kept in `buffers`, so leaving a file costs
    // nothing and there is nothing to ask about.
    (p: string) =>
      void (
        active &&
        window.prism.openWithin(active.root, p).then((payload) => {
          if (!payload) return
          open(payload)
          // Clicking a file means "show me this file". Over a FULL terminal
          // that hides the shell (still running) and gives the file the room;
          // in split the file simply lands in its pane, terminal untouched.
          setTabState((s) => {
            const tab = s.tabs.find((t) => t.id === s.activeId)
            return tab?.term?.view === 'full'
              ? { ...s, tabs: setTabTerm(s.tabs, tab.id, { ...tab.term, view: 'hidden' }) }
              : s
          })
        })
      ),
    [active, open]
  )

  /** The terminal button's own context menu. */
  const openTermSplit = useCallback(
    () => applyTermView((term, id) => (term ? { ...term, view: 'split' } : { id, view: 'split' })),
    [applyTermView]
  )
  const clearTerm = useCallback(() => {
    const id = active?.term?.id
    if (id) void import('./components/TerminalPanel').then((m) => m.clearTermSession(id))
  }, [active])

  /** The split's X buttons and the context menu's "Remove from split view".
   *  Closing the FILE pane leaves the terminal, which takes the full view;
   *  closing the TERMINAL pane leaves the file. Either way the split is gone. */
  const closeFilePane = useCallback(
    () => applyTermView((term, id) => (term ? { ...term, view: 'full' } : { id, view: 'full' })),
    [applyTermView]
  )
  const closeTermPane = useCallback(
    () => applyTermView((term, id) => (term ? { ...term, view: 'hidden' } : { id, view: 'hidden' })),
    [applyTermView]
  )

  /** The context menu: show THIS file, with the terminal beside it. */
  const openFileSplit = useCallback(
    (p: string) => {
      openFromTree(p)
      applyTermView((term, id) => (term ? { ...term, view: 'split' } : { id, view: 'split' }))
    },
    [applyTermView, openFromTree]
  )

  const toggleFullscreen = useCallback(() => window.prism.setFullscreen(!fullscreen), [fullscreen])

  // The visible list: every viewable sibling, in the chosen order, and the
  // open file's position among them. Sorting reuses the same file objects, so
  // mapping back to rawIndex keeps working. (A kind filter lived here once,
  // removed 2026-08-20: a forgotten filter read as missing files.)
  const sort = useSort()
  const view = useMemo(() => {
    if (!active || rawIndex < 0 || !active.files.length) return null
    const files = sortFiles(active.files, sort.field, sort.dir)
    return { files, index: Math.max(0, files.indexOf(active.files[rawIndex])) }
  }, [active, rawIndex, sort])

  const go = useCallback(
    (delta: number) => {
      if (!active || !view) return
      const next = Math.max(0, Math.min(view.files.length - 1, view.index + delta))
      if (next === view.index) return // already at the edge; not a navigation
      setRawIndex(active.files.indexOf(view.files[next]))
      setHasNavigated(true)
    },
    [active, setRawIndex, view]
  )

  const file = view?.files[view.index] ?? null
  const termView = active?.term?.view ?? 'hidden'

  // Whether the open document currently holds focus. Documents mark their own
  // scroller with data-doc-scroller; nothing auto-focuses one, so this is true
  // only after the user has actually clicked into (or tabbed to) the document.
  const docFocused = (): boolean => {
    const el = document.activeElement
    return !!el && !!el.closest('[data-doc-scroller]')
  }

  // Autoplay's landing: the next file of the SAME kind, however many images or
  // documents sit between - a folder of episodes plays like a season, whatever
  // else lives beside them. Stops quietly at the end of the folder.
  const advanceSameKind = useCallback(() => {
    if (!active || !view) return
    const current = view.files[view.index]
    if (!current) return
    for (let i = view.index + 1; i < view.files.length; i += 1) {
      if (view.files[i].kind === current.kind) {
        setRawIndex(active.files.indexOf(view.files[i]))
        return
      }
    }
  }, [active, setRawIndex, view])

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
    (p: string) => void (active && window.prism.openWithin(active.root, p).then((payload) => payload && open(payload))),
    [active, open]
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
      else closeActiveTab()
    },
    [closeActiveTab, file, reopen, view]
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
      // isContentEditable covers the code editor: CodeMirror types into a div,
      // not a textarea, and the arrows there belong to the caret, not the folder.
      const typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
      // A focused terminal is typing too (xterm's hidden textarea), but the
      // tab-management hotkeys still belong to Prism there: no shell uses
      // Ctrl+T, Ctrl+Tab or Ctrl+digits. The keys shells DO live on - Ctrl+C,
      // Ctrl+D (EOF), Ctrl+W (delete-word), Ctrl+B (vim, tmux), Ctrl+S (XOFF),
      // Escape, the arrows - stay the shell's; only the search box, a rename
      // and the text editor keep the full typing shield.
      const inTerm = !!el && !!el.closest('.xterm')
      // The setup owns the window while it is up: none of these should reach the
      // app behind it, least of all Escape, which would close Prism mid-guide.
      if (setup) return
      if (e.key === 'F11') {
        e.preventDefault()
        window.prism.setFullscreen(!fullscreen)
      } else if (e.key === '`' && e.ctrlKey) {
        // NOT behind the typing guard: one of the few keys Prism claims over
        // a focused terminal (F11 and Ctrl+Shift+T are the others).
        // Everything else, Escape and Ctrl+W included, belongs to the shell.
        e.preventDefault()
        toggleTerm()
      } else if ((e.code === 'KeyT' || e.key === 't' || e.key === 'T') && e.ctrlKey && e.shiftKey) {
        // Also claimed while the shell is focused: it never hides, it only
        // brings the terminal to full view, so it cannot eat typed text.
        e.preventDefault()
        openTermFull()
      } else if ((e.code === 'KeyD' || e.key === 'd' || e.key === 'D') && e.ctrlKey && !e.shiftKey && !typing) {
        // Split, from the FILE side. Behind the typing guard on purpose: in
        // the shell Ctrl+D stays the shell's (EOF, delete-char-or-exit).
        e.preventDefault()
        toggleTermSplit()
      } else if ((e.code === 'KeyT' || e.key === 't' || e.key === 'T') && e.ctrlKey && (!typing || inTerm)) {
        e.preventDefault()
        newTab()
      } else if ((e.code === 'KeyW' || e.key === 'w' || e.key === 'W') && e.ctrlKey && (!typing || inTerm)) {
        // Deliberately does NOT take the window on the last tab. Prism is
        // resident, and a window that vanishes under a reflex keystroke -
        // with unsaved text in it - is the failure the close flow exists to
        // prevent. The last tab leaves an empty window instead.
        e.preventDefault()
        closeActiveTab()
      } else if (e.key === 'Tab' && e.ctrlKey && (!typing || inTerm)) {
        e.preventDefault()
        stepTab(e.shiftKey ? -1 : 1)
      } else if (e.ctrlKey && (!typing || inTerm) && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        jumpTab(Number(e.key))
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
        // A focused document gives the keys back before the window gives up.
        // Escape is the way out of a document you clicked into, the same as it
        // is out of the text editor; only then does it reach the window.
        if (docFocused()) {
          e.preventDefault()
          ;(document.activeElement as HTMLElement | null)?.blur()
          return
        }
        if (fullscreen) window.prism.setFullscreen(false)
        else window.prism.close()
      } else if (e.key === 'PageDown' || e.key === 'PageUp') {
        // Same rule as the arrows: the document has these only once it has
        // been focused. Reading a pdf from the sidebar should page the folder.
        if (docFocused()) return
        go(e.key === 'PageDown' ? 1 : -1)
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing) {
        // FOCUS decides, for every kind. A document owns the vertical keys only
        // while it is focused - click into it, or Tab to it. Until then it has
        // no more claim on them than a photo does, so arrowing through a folder
        // from the sidebar behaves the same whatever kind of file it lands on.
        // (`typing` already covered the text editor's caret, above.)
        if (docFocused()) return
        e.preventDefault()
        // The tree gets first refusal: it walks folders as well as files, and
        // says no when it isn't there to walk.
        const dir = e.key === 'ArrowDown' ? 'down' : 'up'
        if (!fullscreen && treeNav.current?.(dir)) return
        go(e.key === 'ArrowDown' ? 1 : -1)
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !typing) {
        const playerOwnsArrows = !!file && PLAYABLE.has(file.kind) && !hasNavigated
        if (!playerOwnsArrows) {
          e.preventDefault() // player checks defaultPrevented and yields
          // Left/Right keep meaning previous/next FILE, and on a folder row
          // they are its chevron. Either way the tree answers first.
          const dir = e.key === 'ArrowRight' ? 'right' : 'left'
          if (!fullscreen && treeNav.current?.(dir)) return
          go(e.key === 'ArrowRight' ? 1 : -1)
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeActiveTab, file, fullscreen, go, hasNavigated, jumpTab, newTab, openTermFull, settingsOpen, setup, stepTab, togglePanel, toggleTerm, toggleTermSplit])

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
      // A drop on the terminal panel types the path there; it is not an open.
      if ((e.target as HTMLElement | null)?.closest?.('[data-term-panel]')) return
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
          name={sidebar && active && !settingsOpen ? '' : (file?.name ?? '')}
          pos={pos}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((v) => !v)}
          panelOpen={settingsOpen ? !compactRail : sidebar}
          onTogglePanel={togglePanel}
          setup={setup}
          wash={washed}
          // Only markdown takes the pencil. Code and plain text have no
          // rendered form to leave, so they are simply editable where they sit.
          editable={file?.kind === 'text' && isMarkdown(file.name)}
          editing={editMode}
          dirty={dirtyPaths.size > 0}
          onToggleEdit={() => setEditMode((v) => !v)}
        />
      )}
      {/* Under the bar, and only once there are two or more: one tab is exactly
          the chrome Prism has always had, so someone quick-looking a single
          photo never meets a workspace element. Gone in fullscreen with the
          rest of it. */}
      {!fullscreen && (
        <TabStrip
          tabs={tabs}
          activeId={activeId}
          onPick={pickTab}
          onClose={closeOneTab}
          onNew={newTab}
          wash={washed}
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
        {active && !fullscreen && (
          <Sidebar
            open={sidebar}
            root={active.root}
            onOpenFolder={rerootHere}
            onToggleTerm={toggleTerm}
            termOpen={termView !== 'hidden'}
            onOpenSplit={openFileSplit}
            splitPath={termView === 'split' ? (file?.path ?? null) : null}
            onRemoveSplit={closeFilePane}
            onTermSplit={openTermSplit}
            onClearTerm={active.term ? clearTerm : null}
            state={active.tree}
            onTree={onTree}
            currentPath={file?.path ?? null}
            // Only the open file can hold unsaved text, so one flag is enough
            // to mark the one row that needs marking.
            dirtyPaths={dirtyPaths}
            onNav={onNav}
            refreshKey={refreshKey}
            onOpenFile={openFromTree}
            // Renaming or binning the edited file (or a folder over it) would
            // silently drop the editor's unsaved text; those ask first too.
            onRename={(p, name) => void runRename(p, name, 'ask')}
            onDelete={(path, name, isFolder) => setAsk({ kind: 'delete', path, name, isFolder })}
            wash={washed}
          />
        )}
        <div
          className="flex min-w-0 min-h-0 flex-1"
          style={{ flexDirection: dockFlex(dockEdge) }}
        >
        <div
          className={`group relative flex min-w-0 min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--p-bg)] ${
            washed ? 'p-wash' : ''
          } ${dragging ? 'ring-2 ring-inset ring-[var(--p-accent)]' : ''} ${
            // Full view: the terminal takes the whole area, but the viewer
            // stays MOUNTED so scroll, zoom and playback survive the visit -
            // the same reason hidden shells stay alive.
            termView === 'full' ? 'hidden' : ''
          }`}
        >
          {/* Keyed by KIND, not by path. Keying by path remounted the viewer on
              every arrow press, which threw the current picture away before the
              next one had decoded and flashed the window black between them.
              A viewer keeps itself in order across files of its own kind; only
              a change of kind needs a fresh one. */}
          {file && editMode && file.kind === 'text' ? (
            <Suspense fallback={<EditorLoading />}>
              <CodeView
                path={file.path}
                name={file.name}
                onClose={() => setEditMode(false)}
                onSaved={() => {
                  setEditMode(false)
                  setDocVersion((v) => v + 1) // the rendered view re-reads what was saved
                }}
                onBuffer={onBuffer}
                getPending={getPending}
              />
            </Suspense>
          ) : file ? (
            <Viewer key={`${file.kind}:${docVersion}`} file={file} onToggleFullscreen={toggleFullscreen} fullscreen={fullscreen} transportStyle={transportStyle} onOpenLocal={openFromTree} onAutoAdvance={advanceSameKind} onBuffer={onBuffer} getPending={getPending} />
          ) : (
            <EmptyState onOpen={browse} onOpenFolder={rerootHere} />
          )}
          {/* No on-screen arrows: paging is the keyboard's job. Left and right,
              up and down, PageUp and PageDown, in or out of fullscreen. */}
          {termView === 'split' && !fullscreen && (
            <button
              className="no-drag absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded bg-black/30 text-[var(--p-icon)] opacity-0 transition-opacity hover:bg-black/50 hover:text-[var(--p-text)] focus-visible:opacity-100 group-hover:opacity-100"
              onClick={closeFilePane}
              title="Remove from split view"
              aria-label="Remove the file from the split"
            >
              <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>
        {/* The tab's shell, when it is visible. Only the ACTIVE tab's panel is
            in the DOM; hidden tabs' sessions stay alive in the store, and
            coming back reattaches them with scrollback intact. Full view is
            the terminal's home; split is the dock. Fullscreen is for watching:
            no terminal, like the rest of the chrome. */}
        {active?.term && termView !== 'hidden' && !fullscreen && (
          <TermDock
            mode={termView}
            onClose={closeTermPane}
            edge={dockEdge}
            size={termSizes[dockAxis(dockEdge)]}
            onResize={resizeTermPanel}
            onDockPick={pickDock}
            sessionId={active.term.id}
            root={active.root}
            shellId={savedShellId()}
          />
        )}
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

      {ask?.kind === 'close-dirty' && (
        <Dialog
          title={unsavedNames.length > 1 ? `${unsavedNames.length} files have unsaved changes` : 'Unsaved changes'}
          body={
            <>
              <span className="text-[#d7dae1]">{unsavedNames.join(', ') || 'This file'}</span>
              {unsavedNames.length > 1 ? ' are not on disk yet.' : ' has changes that are not on disk yet.'}{' '}
              Closing without saving throws them away.
            </>
          }
          onCancel={() => setAsk(null)}
          choices={[
            { label: 'Cancel', onPick: () => setAsk(null) },
            {
              // Not `danger`: discarding here throws away typing, not a file,
              // and the red read as heavier than the act. Same weight as
              // Cancel; "Save all changes" is the one carrying the accent.
              label: 'Discard',
              onPick: () => {
                buffers.current.clear()
                syncDirty()
                setAsk(null)
                window.prism.close(true)
              }
            },
            {
              label: 'Save all changes',
              primary: true,
              onPick: () => {
                void (async () => {
                  // A failed write must not close the window over the top of the
                  // text it failed to keep: we stay put and say which file.
                  const failed = await saveAll()
                  if (failed.length) {
                    setAsk({
                      kind: 'failed',
                      message: `Couldn't save ${failed.map(baseName).join(', ')}.`
                    })
                    return
                  }
                  setAsk(null)
                  window.prism.close(true)
                })()
              }
            }
          ]}
        />
      )}

      {ask?.kind === 'close-tab-confirm' && (
        <Dialog
          title="Close this tab?"
          body={
            <>
              <span className="text-[#d7dae1]">{ask.label}</span> closes, and its shell (if one is
              running) goes with it. Settings can turn this question off.
            </>
          }
          onCancel={() => setAsk(null)}
          choices={[
            { label: 'Cancel', onPick: () => setAsk(null) },
            {
              label: 'Close tab',
              primary: true,
              onPick: () => {
                setAsk(null)
                forceCloseTab(ask.id)
              }
            }
          ]}
        />
      )}

      {ask?.kind === 'close-tab' && (
        <Dialog
          title={ask.names.length > 1 ? `${ask.names.length} files have unsaved changes` : 'Unsaved changes'}
          body={
            <>
              <span className="text-[#d7dae1]">{ask.names.join(', ')}</span>
              {ask.names.length > 1 ? ' are not on disk yet.' : ' has changes that are not on disk yet.'}{' '}
              Closing this folder is the last way back to them.
            </>
          }
          onCancel={() => setAsk(null)}
          choices={[
            { label: 'Cancel', onPick: () => setAsk(null) },
            {
              // Same weight as Cancel, as in the window's question: discarding
              // throws away typing, not a file, and red read heavier than the act.
              label: 'Discard',
              onPick: () => {
                const tab = tabs.find((t) => t.id === ask.id)
                if (tab) {
                  const r = tab.root.toLowerCase()
                  for (const key of [...buffers.current.keys()]) {
                    if (key.startsWith(r)) buffers.current.delete(key)
                  }
                  syncDirty()
                }
                setAsk(null)
                forceCloseTab(ask.id)
              }
            },
            {
              label: 'Save all changes',
              primary: true,
              onPick: () => {
                void (async () => {
                  // A failed write must not close the tab over the top of the
                  // text it failed to keep, exactly as on the window's route.
                  const failed = await saveAll()
                  if (failed.length) {
                    setAsk({
                      kind: 'failed',
                      message: `Couldn't save ${failed.map(baseName).join(', ')}.`
                    })
                    return
                  }
                  setAsk(null)
                  forceCloseTab(ask.id)
                })()
              }
            }
          ]}
        />
      )}

      {ask?.kind === 'reroot' && (
        <Dialog
          title={ask.names.length > 1 ? `${ask.names.length} files have unsaved changes` : 'Unsaved changes'}
          body={
            <>
              <span className="text-[#d7dae1]">{ask.names.join(', ')}</span>
              {ask.names.length > 1 ? ' are not on disk yet.' : ' has changes that are not on disk yet.'}{' '}
              Opening another folder here is the last way back to them.
            </>
          }
          onCancel={() => setAsk(null)}
          choices={[
            { label: 'Cancel', onPick: () => setAsk(null) },
            {
              label: 'Discard',
              onPick: () => {
                const tab = tabs.find((t) => t.id === ask.id)
                if (tab) {
                  const r = tab.root.toLowerCase()
                  for (const key of [...buffers.current.keys()]) {
                    if (key.startsWith(r)) buffers.current.delete(key)
                  }
                  syncDirty()
                }
                setAsk(null)
                applyReroot(ask.id, ask.payload)
              }
            },
            {
              label: 'Save all changes',
              primary: true,
              onPick: () => {
                void (async () => {
                  const failed = await saveAll()
                  if (failed.length) {
                    setAsk({
                      kind: 'failed',
                      message: `Couldn't save ${failed.map(baseName).join(', ')}.`
                    })
                    return
                  }
                  setAsk(null)
                  applyReroot(ask.id, ask.payload)
                })()
              }
            }
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
