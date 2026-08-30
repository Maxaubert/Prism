import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { OnClash, OpenPayload, ViewerFile } from '@shared/types'
import { preloadImage } from './lib/imageLoader'
import {
  addTab,
  closeTab,
  toggleSettingsTab,
  receiveFile,
  reorderTabs,
  rerootTab,
  sameRoot,
  setTabPanes,
  setTabTerm,
  toggleTermView,
  type TabState,
  type TreeState
} from './lib/tabs'
import {
  lastSplitDir,
  paneAreas,
  pinPane,
  saveSplitDir,
  unpinPane,
  type SplitDir
} from './lib/panes'
import { fileKind } from '@shared/fileKind'
import {
  dockAxis,
  dockFlex,
  loadDock,
  loadTermSize,
  saveDock,
  saveTermSize,
  type DockEdge
} from './lib/termDock'
import { savedShellId } from './lib/termPrefs'
import { confirmCloseMode } from './lib/tabPrefs'
import { newTabFolder, newTabMode, newTabShow } from './lib/newTabPrefs'
import { forgetRoot, rememberRoot } from './lib/recentRoots'
import {
  activitySuppressed,
  inputEcho,
  isTouched,
  markResume,
  suppressActivity
} from './lib/termActivity'
import { TermDock } from './components/TermDock'
import { focusTermSession } from './components/TerminalPanel'
import { sortFiles, useSort } from './lib/sortPrefs'
import { useTreeSide } from './lib/treePrefs'
import { VideoView } from './components/VideoView'
import { AudioView } from './components/AudioView'
import { ImageView } from './components/ImageView'
import { UnsupportedView } from './components/UnsupportedView'
import { ArchiveView } from './components/ArchiveView'
// Split out, all four, for the same reason: none of them is on the path of
// opening a photo, and the resident single-instance model exists so the window
// is there the instant you ask. CodeMirror is ~770KB, pdf.js about a megabyte,
// and react-markdown brings remark, rehype and micromark with it.
const CodeView = lazy(() => import('./components/CodeView').then((m) => ({ default: m.CodeView })))
const PdfView = lazy(() => import('./components/pdf/PdfView').then((m) => ({ default: m.PdfView })))
const MarkdownView = lazy(() =>
  import('./components/MarkdownView').then((m) => ({ default: m.MarkdownView }))
)
const DocView = lazy(() => import('./components/DocView').then((m) => ({ default: m.DocView })))
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
import {
  loadTransportBg,
  loadTransportStyle,
  TRANSPORT_BG_KEY,
  TRANSPORT_KEY,
  type TransportStyle
} from './lib/transport'
import { archivePassword } from './lib/archivePass'
import { deckOf } from './lib/mediaDeck'
import { intendToPlay, wasPlaying } from './lib/playState'
import { forgetTabVolume } from './lib/tabVolume'
import { dragPayload, setDrag, type DragPayload } from './lib/dragDrop'
import {
  describe as describeUndo,
  emptyUndo,
  redone,
  remember,
  undone,
  type UndoEntry,
  type UndoState
} from './lib/undo'

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
  | { kind: 'delete-many'; paths: string[] }
  | { kind: 'move-clash'; paths: string[]; dest: string; names: string[] }
  | { kind: 'clash'; path: string; name: string; suggestion: string }
  | { kind: 'failed'; message: string }
  | { kind: 'close-dirty'; then?: 'install' }
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
  update,
  updatePhase,
  updatePct,
  onInstallUpdate,
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
  /** A newer release exists (mock in unpackaged builds, so the chip can be
   *  seen; the installed app only shows a real one). */
  update: { version: string; mock?: boolean } | null
  updatePhase: 'idle' | 'downloading' | 'installing'
  updatePct: number
  onInstallUpdate: () => void
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
            panelOpen
              ? 'text-[var(--p-accent-hi)]'
              : 'text-[var(--p-icon)] hover:text-[var(--p-text)]'
          }`}
          onClick={onTogglePanel}
          title={settingsOpen ? 'Collapse the rail (Ctrl+B)' : 'Files (Ctrl+B)'}
          aria-label={settingsOpen ? 'Collapse the settings rail' : 'Toggle file tree'}
          aria-pressed={panelOpen}
        >
          <svg
            viewBox="0 0 24 24"
            width={15}
            height={15}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>
      )}
      <span className={`font-semibold text-[var(--p-accent-hi)] ${setup ? '-ml-0.5' : ''}`}>
        Prism
      </span>
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
      {/* The update chip: quiet accent pill, present only while there is
          something to install. A mock (unpackaged builds) is inert - it
          exists so the chip can be seen before a real release carries it. */}
      {!setup && update && (
        <button
          // The chip IS the progress bar: it never changes size, and the same
          // shape carries "available", "42%" and "installing" without the
          // title bar reflowing under it.
          className="no-drag relative flex h-6 shrink-0 items-center gap-1.5 overflow-hidden rounded-md border px-2.5 text-[11.5px] font-medium transition-[filter] hover:brightness-125"
          style={{
            borderColor:
              updatePhase === 'idle'
                ? 'color-mix(in srgb, var(--p-text) 14%, transparent)'
                : 'color-mix(in srgb, var(--p-accent) 55%, transparent)',
            // Working: the unfilled remainder is already accent-tinted, so the
            // label reads against both halves of the bar.
            background:
              updatePhase === 'idle'
                ? 'color-mix(in srgb, var(--p-text) 8%, transparent)'
                : 'color-mix(in srgb, var(--p-accent) 30%, transparent)',
            color: updatePhase === 'idle' ? 'var(--p-text)' : 'var(--p-on-accent)'
          }}
          onClick={onInstallUpdate}
          disabled={updatePhase !== 'idle'}
          title={
            update.mock
              ? 'Preview: the installed app only shows this when a newer release exists'
              : `Download and install ${update.version}`
          }
          aria-label={`Update to ${update.version}`}
          {...(updatePhase === 'downloading'
            ? {
                role: 'progressbar',
                'aria-valuenow': updatePct,
                'aria-valuemin': 0,
                'aria-valuemax': 100
              }
            : {})}
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 transition-[width] duration-300 ease-out"
            style={{
              width:
                updatePhase === 'idle'
                  ? 0
                  : updatePhase === 'installing'
                    ? '100%'
                    : `${updatePct}%`,
              background: 'var(--p-accent)'
            }}
          />
          <svg
            viewBox="0 0 24 24"
            width={11}
            height={11}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="relative shrink-0"
            aria-hidden
          >
            <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14" />
          </svg>
          <span className="relative whitespace-nowrap tabular-nums">
            {updatePhase === 'downloading'
              ? `${updatePct}%`
              : updatePhase === 'installing'
                ? 'Installing…'
                : `Update ${update.version}`}
          </span>
        </button>
      )}
      <div className="no-drag flex items-center gap-1">
        {!setup && editable && (
          <button
            className={`grid h-7 w-8 place-items-center rounded transition-colors hover:bg-white/10 ${
              editing
                ? 'text-[var(--p-accent-hi)]'
                : 'text-[var(--p-icon)] hover:text-[var(--p-text)]'
            }`}
            onClick={onToggleEdit}
            title={editing ? 'Stop editing' : 'Edit'}
            aria-label="Edit"
            aria-pressed={editing}
          >
            <svg
              viewBox="0 0 24 24"
              width={15}
              height={15}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
            </svg>
          </button>
        )}
        {!setup && (
          <button
            className={`grid h-7 w-8 place-items-center rounded transition-colors hover:bg-white/10 ${
              settingsOpen
                ? 'text-[var(--p-accent-hi)]'
                : 'text-[var(--p-icon)] hover:text-[var(--p-text)]'
            }`}
            onClick={onToggleSettings}
            title="Settings"
            aria-label="Settings"
            aria-pressed={settingsOpen}
          >
            <svg
              viewBox="0 0 24 24"
              width={15}
              height={15}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden
            >
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.64.73.83H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </button>
        )}
        <button
          className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
          onClick={() => w.minimize()}
        >
          –
        </button>
        <button
          className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
          onClick={() => w.toggleMaximize()}
        >
          ▢
        </button>
        <button
          className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-red-500/80 hover:text-[var(--p-text)]"
          onClick={() => w.close()}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// The one kind with two faces: markdown renders, and the pencil shows its
// source. Every other text file is only ever itself, so it needs no toggle.
const isMarkdown = (name: string): boolean => /\.(md|markdown)$/i.test(name)

/** The last segment of a path, either separator. */
const baseName = (p: string): string => /[^\\/]*$/.exec(p)?.[0] ?? p

/** The folder a path lives in. Undo puts things back where they came from. */
const parentDir = (p: string): string => p.replace(/[\\/][^\\/]*$/, '') || p

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
  onUndoable,
  refreshKey,
  onToggleFullscreen,
  fullscreen,
  transportStyle,
  transportBg,
  onOpenLocal,
  onAutoAdvance,
  onStep,
  canStep,
  onBuffer,
  onRenameSelf,
  getPending,
  background = false,
  volumeKey = ''
}: {
  file: ViewerFile
  /** An archive reports its own undoable writes up to App's stack. */
  onUndoable: (entry: UndoEntry) => void
  /** An archive's own "Rename" verb: App owns renaming, so it does it. */
  onRenameSelf: (name: string) => void
  /** Bumped after an undo, so an open archive re-reads its container. */
  refreshKey: number
  onToggleFullscreen: () => void
  fullscreen: boolean
  transportStyle: TransportStyle
  /** How solid the band behind the video's controls is, 0-100%. */
  transportBg: number
  /** A markdown link to a local file; opened the same way as a tree click. */
  onOpenLocal: (path: string) => void
  /** Autoplay: a finished video/track moves to the next of its kind. */
  onAutoAdvance: () => void
  /** The video menu's Next / Previous, by the same rule. */
  onStep: (dir: 1 | -1) => void
  canStep: (dir: 1 | -1) => boolean
  /** Code and text edit in place, so the viewer hands its buffer up to App. */
  onBuffer: (path: string, text: string | null) => void
  /** Asked for the unsaved text of a file, if App is holding any. */
  getPending: (path: string) => string | undefined
  /** This tab is not the one in front: its player keeps going, unseen. */
  background?: boolean
  /** Whose volume this player uses - the tab's, for the session. */
  volumeKey?: string
}): JSX.Element {
  const url = window.prism.mediaUrl(file.path)
  switch (file.kind) {
    case 'video':
      return (
        <VideoView
          url={url}
          path={file.path}
          onToggleFullscreen={onToggleFullscreen}
          onAutoAdvance={onAutoAdvance}
          onStep={onStep}
          canStep={canStep}
          transportStyle={transportStyle}
          transportBg={transportBg}
          background={background}
          volumeKey={volumeKey}
          fullscreen={fullscreen}
        />
      )
    case 'image':
      return <ImageView url={url} name={file.name} onToggleFullscreen={onToggleFullscreen} />
    case 'audio':
      return (
        <AudioView
          url={url}
          path={file.path}
          name={file.name}
          fullscreen={fullscreen}
          onToggleFullscreen={onToggleFullscreen}
          onAutoAdvance={onAutoAdvance}
          transportStyle={transportStyle}
          background={background}
          volumeKey={volumeKey}
        />
      )
    case 'pdf':
      return (
        <Suspense fallback={<EditorLoading />}>
          <PdfView url={url} onToggleFullscreen={onToggleFullscreen} />
        </Suspense>
      )
    case 'doc':
      return (
        <Suspense fallback={<EditorLoading />}>
          <DocView path={file.path} name={file.name} />
        </Suspense>
      )
    case 'archive':
      return (
        <ArchiveView
          file={file}
          fullscreen={fullscreen}
          onUndoable={onUndoable}
          onRenameSelf={onRenameSelf}
          refreshKey={refreshKey}
        />
      )
    case 'text':
      // Markdown is a document until the pencil says otherwise; everything else
      // is its own source, editable where it sits. A save here changes nothing
      // on screen that isn't already there, so it must not remount the viewer.
      return isMarkdown(file.name) ? (
        <Suspense fallback={<EditorLoading />}>
          <MarkdownView path={file.path} onOpenLocal={onOpenLocal} />
        </Suspense>
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
      // Windows can always hand us a file we don't show: the "Choose another
      // app" dialog lists every installed application, not just the ones
      // registered for the type. Say so plainly instead of leaving an empty
      // window with a grey line in it.
      return <UnsupportedView file={file} />
  }
}

/** One pinned split pane: a fixed file, independent of paging, with its X. */
function PinnedPaneView({
  paneId,
  path,
  area,
  onClose,
  viewerProps
}: {
  paneId: string
  path: string
  area: string
  onClose: () => void
  viewerProps: Omit<Parameters<typeof Viewer>[0], 'file'>
}): JSX.Element {
  const name = path.split(/[\\/]/).pop() ?? path
  const ext = /\.[^.]+$/.exec(name)?.[0]?.toLowerCase() ?? ''
  const file: ViewerFile = { path, name, ext, kind: fileKind(ext, name), size: 0, mtimeMs: 0 }
  return (
    <div
      data-pane="pinned"
      data-pane-id={paneId}
      className="group/pane relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-[var(--p-bg)]"
      style={{ gridArea: area }}
    >
      <Viewer key={`${file.kind}:${path}`} file={file} {...viewerProps} />
      <button
        className="no-drag absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded bg-black/30 text-[var(--p-icon)] opacity-0 transition-opacity hover:bg-black/50 hover:text-[var(--p-text)] focus-visible:opacity-100 group-hover/pane:opacity-100"
        onClick={onClose}
        title="Remove from split view"
        aria-label={`Remove ${name} from split view`}
      >
        <svg
          viewBox="0 0 24 24"
          width={11}
          height={11}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}

function EmptyState({
  onOpen,
  onOpenFolder
}: {
  onOpen: () => void
  onOpenFolder: () => void
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      {/* A hairline and nothing else, so the window's own material carries
          through it. No backdrop-filter: inside a transparent window it has
          nothing behind to sample and composites as a solid fill, which is
          exactly the opaque tile this was meant to get rid of. */}
      <div className="grid h-[72px] w-[72px] place-items-center rounded-[20px] border border-[color:var(--p-line)] text-[var(--p-accent-hi)]">
        <svg
          viewBox="0 0 24 24"
          width={30}
          height={30}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M7 18a4 4 0 0 1 .6-8 5.2 5.2 0 0 1 10 1.2A3.4 3.4 0 0 1 17.5 18z" />
          <path d="M12 11v6m0 0l-2.2-2.2M12 17l2.2-2.2" />
        </svg>
      </div>
      <div className="text-lg font-semibold">Open a file or folder to view it</div>
      <div className="text-sm text-[var(--p-dim)]">Drop a file here, or</div>
      <div className="flex items-center gap-2">
        <button
          className="no-drag rounded-xl bg-[var(--p-accent)] px-4 py-2 text-sm font-semibold text-[var(--p-on-accent)] hover:brightness-110"
          onClick={onOpen}
        >
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

/** A tab with a root but nothing on screen yet (a terminal-first tab whose
 *  terminal was tucked away): quiet words, not the open-file pitch. The way
 *  in is the sidebar this tab already has, so nothing here needs a button.
 *  Deliberately NOT the first file auto-opened: a hidden terminal must never
 *  start playing whatever happens to sort first. */
function NoFileState(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
      <div className="text-sm font-medium text-[var(--p-dim)]">No file selected</div>
      <div className="text-xs text-[var(--p-dim2)]">Pick one from the sidebar</div>
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
  const settingsOpen = active?.kind === 'settings'
  const toggleSettings = useCallback(() => {
    setTabState((s) =>
      toggleSettingsTab(s.tabs, s.activeId, `settings-${(settingsSeq.current += 1)}`)
    )
  }, [])
  const closeSettingsTab = useCallback(() => {
    setTabState((s) => {
      const st = s.tabs.find((t) => t.kind === 'settings')
      return st ? closeTab(s.tabs, st.id, s.activeId) : s
    })
  }, [])
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
  const [transportBg, setTransportBg] = useState<number>(loadTransportBg)
  // Settings rides the strip as a tab of its own kind, so it can be flipped
  // to and from like any other. `settingsOpen` is simply "the settings tab is
  // in front"; the page itself stays mounted underneath either way, keeping
  // its own internal state.
  const settingsSeq = useRef(0)
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
      if ((await window.prism.writeText(buf.path, buf.text)).ok) buffers.current.delete(key)
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
  const pickTransportBg = useCallback((pct: number) => {
    setTransportBg(pct)
    localStorage.setItem(TRANSPORT_BG_KEY, String(pct))
  }, [])

  /**
   * A file or folder arriving from outside: argv, the second-instance handoff,
   * a drop, or either dialog. `receiveFile` decides where it lands - a tab whose
   * root already holds it, a new tab, or the empty window - and index -1 is a
   * folder that holds nothing viewable, which still opens as a place to browse
   * from rather than a refusal.
   */
  /**
   * Put the "New tabs show" setting into effect on the active tab: a terminal
   * in full view, nothing at all, or (the default) the folder's first file,
   * which is what the payload already carries.
   *
   * Shared by the + and by a FOLDER arriving from Explorer's menu, which is
   * the same act by another route and should not answer the question
   * differently.
   */
  const withNewTabShow = useCallback((st: TabState): TabState => {
    const show = newTabShow()
    const tab = st.tabs.find((t) => t.id === st.activeId)
    if (!tab || show === 'file') return st
    if (show === 'terminal') {
      if (tab.term) return st
      const termId = nextTermId()
      termRoots.current.set(termId, tab.root)
      return { ...st, tabs: setTabTerm(st.tabs, tab.id, { id: termId, view: 'full' }) }
    }
    // The quiet start: the sidebar keeps the folder's files, but nothing
    // goes on screen (NoFileState) until the user picks one.
    return { ...st, tabs: st.tabs.map((t) => (t.id === tab.id ? { ...t, index: -1 } : t)) }
  }, [])

  const open = useCallback(
    (p: OpenPayload | null) => {
      if (!p) return
      // A FOLDER from outside (Explorer's menu on a folder, or on the empty
      // space inside one): it roots a tab, and what that tab SHOWS is the "New
      // tabs show" setting, exactly as the + would decide it. A folder Prism
      // already has a tab for switches there instead of making a second - one
      // tab per root - and keeps whatever that tab was showing.
      if (p.folder) {
        // Decided INSIDE the update, against the tabs as they stand: a folder
        // arriving while the strip is still being restored would otherwise
        // look at an empty strip and make a second tab on the same root.
        setTabState((s) => {
          const hit = s.tabs.find((t) => t.kind !== 'settings' && sameRoot(t.root, p.root))
          return hit ? { ...s, activeId: hit.id } : withNewTabShow(addTab(s.tabs, p, nextTabId()))
        })
        setHasNavigated(false)
        return
      }
      setTabState((s) => {
        // A RESTORED tab is always its own tab: receiveFile's same-root fold is
        // for files arriving from outside, and folding a restore silently
        // deleted one of two tabs that shared a root.
        const st = p.restore ? addTab(s.tabs, p, nextTabId()) : receiveFile(s.tabs, p, nextTabId())
        // For a restore the tab in question is the one just appended; for an
        // arrival it is whichever tab the payload landed in (now active).
        const target = p.restore
          ? st.tabs[st.tabs.length - 1]
          : st.tabs.find((t) => t.id === st.activeId)
        let tabs = st.tabs
        // A restored tab that was showing its terminal comes back AS a terminal:
        // a fresh shell at the root (sessions die with the app), same view.
        if (p.term && target && !target.term) {
          const termId = nextTermId()
          termRoots.current.set(termId, target.root)
          // The shell hosted a Claude session at close: the fresh one launches
          // straight into it (spawn carries the id; see TerminalPanel). The
          // session spawns NOW, tab in front or not - every tab's conversation
          // resumes at launch, not when its tab is first visited.
          if (p.agentResume) markResume(termId, p.agentResume)
          const root = target.root
          void import('./components/TerminalPanel').then((m) =>
            m.ensureTermSession(termId, root, savedShellId())
          )
          tabs = setTabTerm(tabs, target.id, { id: termId, view: p.term })
        }
        // Background restores keep the focus where it is: restore arrives in
        // SAVED ORDER now (no more active-goes-last splice, which scrambled the
        // strip), and only the saved active tab takes the front.
        const activeId = p.restore && !p.restoreActive && s.activeId ? s.activeId : st.activeId
        return { tabs, activeId }
      })
      setHasNavigated(false) // a fresh open starts in "opened directly" mode
    },
    [withNewTabShow]
  )

  // Pre-warm: a tab in front with no shell probably gets one soon. After a
  // short dwell, main starts it; opening the terminal then ADOPTS a running
  // shell instead of paying pwsh's startup at the click. The xterm chunk is
  // prefetched once at idle for the same reason.
  useEffect(() => {
    if (!active || active.kind === 'settings' || active.term) return
    const t = setTimeout(() => window.prism.termPrewarm(active.root, savedShellId()), 900)
    return () => clearTimeout(t)
  }, [active])
  useEffect(() => {
    const t = setTimeout(() => void import('./components/TerminalPanel'), 4000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => window.prism.onOpenFile(open), [open])
  useEffect(() => window.prism.onFullscreen(setFullscreen), [])
  /**
   * Fullscreen the way YouTube actually does it: the DOM Fullscreen API on
   * the viewer element, which gets Chromium's own built-in smooth transition
   * for free - no hand-rolled veil, no animation of ours at all. The window
   * fullscreen IPC survives only as the fallback for when the element can't
   * take it (e.g. the viewer is display:none under a full terminal).
   */
  const viewerBox = useRef<HTMLDivElement>(null)
  // The fade-to-black rides ON TOP of the DOM fullscreen: darken (150ms), do
  // the swap under full black, lift (280ms) once the new frame has laid out.
  // The veil lives INSIDE the viewer element - anything outside it stops
  // rendering the moment the element goes fullscreen. Driven by transitionend
  // and rAF, styled directly on the node, so nothing re-renders mid-fade.
  const fsVeilEl = useRef<HTMLDivElement>(null)
  const liftVeil = useCallback(() => {
    const veil = fsVeilEl.current
    if (!veil) return
    // Hold the black a beat (200ms) before lifting: the swap should be felt,
    // not glimpsed. The double rAF then guarantees the new frame is laid out.
    setTimeout(() => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          veil.style.transition = 'opacity 280ms ease-out'
          veil.style.opacity = '0'
        })
      )
    }, 200)
  }, [])
  const setFs = useCallback(
    (on: boolean) => {
      const doSwap = (): void => {
        if (on) {
          const el = viewerBox.current
          if (el)
            el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
              window.prism.setFullscreen(true)
              liftVeil()
            })
          else window.prism.setFullscreen(true)
        } else if (document.fullscreenElement) {
          void document.exitFullscreen()
        } else {
          window.prism.setFullscreen(false)
        }
      }
      const veil = fsVeilEl.current
      if (!veil || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        doSwap()
        return
      }
      veil.style.transition = 'opacity 150ms ease-in'
      veil.style.opacity = '1'
      let fired = false
      const done = (): void => {
        if (fired) return
        fired = true
        // One frame of margin after the fade completes, so the swap happens
        // under GUARANTEED full black, never on the fade's last visible frame.
        setTimeout(doSwap, 40)
      }
      veil.addEventListener('transitionend', done, { once: true })
      setTimeout(done, 240) // transitionend can be swallowed; the swap may not
      setTimeout(liftVeil, 1500) // and if the swap itself failed, never stay black
    },
    [liftVeil]
  )
  useEffect(() => {
    // Element fullscreen is the source of truth; Escape exits it natively and
    // this keeps the app state honest either way.
    const onChange = (): void => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  // Whichever path changed the state (element, fallback, OS), the new frame is
  // up: lift the veil over it.
  useEffect(() => liftVeil(), [fullscreen, liftVeil])
  // Main held the window open because the editor is dirty; ask, then answer it.
  useEffect(() => window.prism.onAskClose(() => setAsk({ kind: 'close-dirty' })), [])

  // The update offer and its progress through install. Phase lives here (not
  // in the bar) so the chip survives the bar re-rendering under it.
  const [update, setUpdate] = useState<{ version: string; url: string; mock?: boolean } | null>(
    null
  )
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'downloading' | 'installing'>('idle')
  const [updatePct, setUpdatePct] = useState(0)
  useEffect(() => window.prism.onUpdate(setUpdate), [])
  useEffect(
    () =>
      window.prism.onUpdateProgress((pct) => {
        setUpdatePct(pct)
        if (pct >= 100) setUpdatePhase('installing')
      }),
    []
  )
  const runInstall = useCallback(() => {
    if (!update || update.mock) return
    setUpdatePhase('downloading')
    setUpdatePct(0)
    void window.prism.installUpdate(update.url).then((ok) => {
      // On success the app quits under the installer; only failure comes back.
      if (!ok) setUpdatePhase('idle')
    })
  }, [update])
  const installUpdate = useCallback(() => {
    if (!update || update.mock) return
    // Installing ends in a quit, and unsaved text vetoes a quit - so the same
    // question closing asks is asked here, BEFORE the download (2026-08-28).
    // Main refuses the install outright while anything is dirty.
    if (dirtyPaths.size) setAsk({ kind: 'close-dirty', then: 'install' })
    else runInstall()
  }, [update, dirtyPaths, runInstall])

  // Where the active tab is rooted, for handlers that must stay stable (the
  // + is handed to main once and must not be rebuilt whenever a tab changes).
  const activeRootRef = useRef<string | undefined>(undefined)
  const activeIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeRootRef.current = tabs.find((t) => t.id === activeId)?.root
    activeIdRef.current = activeId
  }, [tabs, activeId])

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
    // Where the tab roots is a Settings choice: the user folder (instant), a
    // remembered folder (instant; falls back to home if it is gone), or the
    // chooser every time. What it shows is a second choice: the folder's
    // first file, a terminal already open in full view, or nothing yet.
    const mode = newTabMode()
    const request =
      mode === 'ask'
        ? window.prism.openFolder(activeRootRef.current)
        : mode === 'folder'
          ? window.prism.openRoot(newTabFolder()).then((p) => p ?? window.prism.openHome())
          : window.prism.openHome()
    void request.then((p) => {
      if (!p) return // ask-mode cancelled: no tab
      setTabState((s) => withNewTabShow(addTab(s.tabs, p, nextTabId())))
      setHasNavigated(false)
    })
  }, [withNewTabShow])

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
        termRoots.current.delete(tab.term.id)
      }
      // ...and so does the level it was playing at: the id never comes back.
      forgetTabVolume(id)
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
    setTabState((s) => {
      const next = rerootTab(s.tabs, id, p, nextTabId())
      // The terminal policy on a folder change: an UNTOUCHED shell simply
      // follows - killed and respawned in the new folder, view kept. A
      // touched one (a Claude session, half-typed work) stays where it was;
      // Clear later re-syncs it.
      const tab = next.tabs.find((t) => t.id === id)
      if (
        tab?.term &&
        !isTouched(tab.term.id) &&
        !sameRoot(termRoots.current.get(tab.term.id) ?? '', p.root)
      ) {
        window.prism.termKill(tab.term.id)
        disposeSession(tab.term.id)
        termRoots.current.delete(tab.term.id)
        const termId = nextTermId()
        termRoots.current.set(termId, p.root)
        return { ...next, tabs: setTabTerm(next.tabs, tab.id, { id: termId, view: tab.term.view }) }
      }
      return next
    })
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
    void window.prism.openFolder(tabs.find((t) => t.id === activeId)?.root).then((p) => {
      if (!p) return
      const here = tabs.find((t) => t.id === activeId)
      const names = here && !sameRoot(here.root, p.root) ? dirtyUnder(here.root) : []
      if (names.length && activeId) setAsk({ kind: 'reroot', id: activeId, names, payload: p })
      else applyReroot(activeId, p)
    })
  }, [activeId, applyReroot, dirtyUnder, tabs])
  // Which sessions host a live agent (Claude, codex and kin). Declared up
  // here because the close path below consults it; the polling effect that
  // feeds it lives with the rest of the terminal wiring.
  const [agentIds, setAgentIds] = useState<ReadonlySet<string>>(new Set())
  /** Close a tab, asking first when that would strand unsaved text. */
  const closeOneTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return
      if (tab.kind === 'settings') {
        forceCloseTab(id)
        return
      }
      // Unsaved text asks in EVERY mode: the setting below only governs the
      // plain "you are closing a tab" confirmation, never data loss.
      const names = dirtyUnder(tab.root)
      if (names.length) setAsk({ kind: 'close-tab', id, names })
      else {
        const mode = confirmCloseMode()
        const agentLive = !!tab.term && agentIds.has(tab.term.id)
        if (mode === 'always' || (mode === 'agent' && agentLive))
          setAsk({
            kind: 'close-tab-confirm',
            id,
            label: tab.root.split(/[\\/]/).filter(Boolean).pop() ?? tab.root
          })
        else forceCloseTab(id)
      }
    },
    [agentIds, dirtyUnder, forceCloseTab, tabs]
  )
  const closeActiveTab = useCallback(() => {
    if (activeId) closeOneTab(activeId)
  }, [activeId, closeOneTab])
  /** Whatever a tab interaction did to DOM focus, a SHOWING terminal gets the
   *  keyboard back: clicking or dragging a tab is not "I left the shell", and
   *  losing focus there sent the arrows off to page the folder instead. */
  const restoreTermFocus = useCallback((id?: string) => {
    setTabState((s) => {
      const tab = s.tabs.find((t) => t.id === (id ?? s.activeId))
      if (tab?.term && tab.term.view !== 'hidden')
        requestAnimationFrame(() => focusTermSession(tab.term!.id))
      return s
    })
  }, [])
  /* The folders Prism has been opened in (2026-08-23): the strip's + offers
     the last few on a right-click. Every root a tab holds is remembered as it
     appears, so the list is what actually happened rather than a curated
     thing to maintain. */
  // Writing only: the menu reads the list when it opens, so there is no
  // second copy of it to keep in step.
  const seenRoots = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const t of tabs) {
      if (t.kind === 'settings' || !t.root) continue
      const key = t.root.toLowerCase()
      if (seenRoots.current.has(key)) continue
      seenRoots.current.add(key)
      rememberRoot(t.root)
    }
  }, [tabs])
  /** A folder from that menu: a tab rooted there, exactly like the + makes.
   *  One that has since been moved or deleted drops out of the list. */
  const openRecent = useCallback((path: string) => {
    void window.prism.openRoot(path).then((p) => {
      if (!p) {
        forgetRoot(path)
        setAsk({ kind: 'failed', message: 'That folder is not there any more.' })
        return
      }
      setTabState((s) => addTab(s.tabs, p, nextTabId()))
      setHasNavigated(false)
    })
  }, [])

  const pickTab = useCallback(
    (id: string) => {
      setTabState((s) => ({ ...s, activeId: id }))
      restoreTermFocus(id)
    },
    [restoreTermFocus]
  )
  /** The strip's own drag: a tab lands in front of `toIndex` (#70). */
  const reorderTab = useCallback(
    (id: string, toIndex: number) =>
      // Focus is the strip's business: it puts back whatever the drag
      // interrupted - a shell, a tree row, the search box - rather than
      // assuming the terminal.
      setTabState((s) => ({ ...s, tabs: reorderTabs(s.tabs, id, toIndex) })),
    []
  )

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
  /** Where each live session was SPAWNED, for the reroot policy: an untouched
   *  shell whose folder no longer matches its tab gets replaced; Clear also
   *  re-syncs a stale one. */
  const termRoots = useRef(new Map<string, string>())
  const applyTermView = useCallback(
    (fn: typeof toggleTermView) =>
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === s.activeId)
        if (!tab || tab.kind === 'settings') return s
        const next = fn(tab.term, nextTermId())
        if (next.id !== tab.term?.id) termRoots.current.set(next.id, tab.root)
        return { ...s, tabs: setTabTerm(s.tabs, tab.id, next) }
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
  /**
   * Tab activity, Tabby-style: a pty is SILENT at an idle prompt and streams
   * continuously while an AI CLI works (its spinner repaints). The dots are
   * AGENT-SCOPED: main polls each shell's process tree for Claude Code and
   * kin, and a plain terminal never shows one (the bell was tried and
   * abandoned - PSReadLine dings on every invalid key). With an agent
   * present: blue while streaming is SUSTAINED (over 1.2s without a 1.5s
   * gap, so banners, redraws and echoes never light it), amber while quiet -
   * a finished answer, waiting.
   */
  const outputRuns = useRef(new Map<string, { start: number; last: number }>())
  const [workingIds, setWorkingIds] = useState<ReadonlySet<string>>(new Set())
  /** Which agent each session hosts - resume is claude-only. */
  const agentKinds = useRef(new Map<string, 'claude' | 'codex' | 'other'>())
  useEffect(
    () =>
      window.prism.onTermAgent((id, present, kind) => {
        if (present && (kind === 'claude' || kind === 'codex' || kind === 'other'))
          agentKinds.current.set(id, kind)
        else if (!present) agentKinds.current.delete(id)
        if (present) {
          // An agent's BIRTH state is idle: its startup paint (banner, welcome
          // box, the loading spinners after it) is a stream, but it is not the
          // agent answering anything. Wipe the run and suppress scoring long
          // enough to outlast the whole startup animation, so the indicator
          // only ever means a real answer underway.
          outputRuns.current.delete(id)
          suppressActivity(id, 4000)
          setWorkingIds((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }
        setAgentIds((prev) => {
          if (present === prev.has(id)) return prev
          const next = new Set(prev)
          if (present) next.add(id)
          else next.delete(id)
          return next
        })
      }),
    []
  )
  useEffect(
    () =>
      window.prism.onTermData((id) => {
        // Output on the heels of a keystroke is that keystroke's echo (the TUI
        // repainting its input box), so typing at an idle agent never scores.
        if (!activitySuppressed(id) && !inputEcho(id)) {
          const now = Date.now()
          const run = outputRuns.current.get(id)
          if (!run || now - run.last > 1500) outputRuns.current.set(id, { start: now, last: now })
          else run.last = now
        }
      }),
    []
  )
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
    const folderTabs = tabs.filter((t) => t.kind !== 'settings')
    const now = folderTabs.map((t) => t.root)
    for (const was of heldRoots.current) {
      if (!now.some((r) => sameRoot(r, was))) window.prism.dropRoot(was)
    }
    heldRoots.current = now
    // Mount says nothing (there is nothing to persist and no root to drop);
    // once a tab has existed, an empty list is real news: the last tab closed.
    if (folderTabs.length) hadTabs.current = true
    else if (!hadTabs.current) return
    window.prism.tabsChanged(
      folderTabs.map((t) => ({
        root: t.root,
        file: t.files[t.index]?.path,
        // A visible terminal is part of what the tab IS: a Claude-session tab
        // must reopen as a terminal next launch, not as an empty viewer.
        term: t.term && t.term.view !== 'hidden' ? t.term.view : undefined,
        // ...and one hosting claude or codex resumes its conversation on
        // restore, each by its own flag. 'other' agents have nothing to
        // come back to, so they are not recorded.
        agent: (() => {
          if (!t.term || t.term.view === 'hidden' || !agentIds.has(t.term.id)) return undefined
          const kind = agentKinds.current.get(t.term.id)
          return kind === 'claude' || kind === 'codex' ? kind : undefined
        })()
      })),
      Math.max(
        0,
        folderTabs.findIndex((t) => t.id === activeId)
      )
    )
  }, [tabs, activeId, agentIds])

  // One slow tick derives "working" from the runs; state only changes when
  // the set actually changes, so idle terminals cost nothing.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now()
      setWorkingIds((prev) => {
        const next = new Set<string>()
        for (const [id, run] of outputRuns.current) {
          if (now - run.last < 2000 && run.last - run.start > 1200) next.add(id)
        }
        if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev
        return next
      })
    }, 700)
    return () => clearInterval(t)
  }, [])
  // Finished-while-away: an agent that STOPS working on a background tab
  // leaves a mark that stays until the tab is visited (or work restarts).
  // An answer that lands while you are watching needs no flag; one that
  // lands behind another tab is news the strip should carry.
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set())
  const prevWorking = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const was = prevWorking.current
    prevWorking.current = workingIds
    const activeTerm = tabs.find((t) => t.id === activeId)?.term?.id
    setDoneIds((prev) => {
      let next: Set<string> | null = null
      const mut = (): Set<string> => (next ??= new Set(prev))
      for (const id of was) {
        // Stopped, still an agent session, and its tab is in the background.
        if (!workingIds.has(id) && agentIds.has(id) && id !== activeTerm) mut().add(id)
      }
      for (const id of prev) {
        if (workingIds.has(id) || id === activeTerm) mut().delete(id)
      }
      return next ?? prev
    })
  }, [workingIds, tabs, activeId, agentIds])

  // The shell ended: typed exit, or died. App owns this rather than the panel,
  // because it must be heard even while the panel is hidden or another tab is
  // in front - the tab's term slot has to clear either way.
  useEffect(
    () =>
      window.prism.onTermExit((id) => {
        disposeSession(id)
        outputRuns.current.delete(id)
        termRoots.current.delete(id)
        setAgentIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
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
          setPaneFocus('live') // the clicked file is the live pane's
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
    const term = active?.term
    if (!term || !active) return
    const spawnedAt = termRoots.current.get(term.id)
    if (spawnedAt && !sameRoot(spawnedAt, active.root)) {
      // The tab moved folders while this shell was busy being kept; Clear is
      // the user resetting things, so it re-syncs: fresh shell, tab's folder.
      window.prism.termKill(term.id)
      disposeSession(term.id)
      termRoots.current.delete(term.id)
      const termId = nextTermId()
      termRoots.current.set(termId, active.root)
      setTabState((s) => ({
        ...s,
        tabs: setTabTerm(s.tabs, active.id, { id: termId, view: term.view })
      }))
    } else {
      void import('./components/TerminalPanel').then((m) => m.clearTermSession(term.id))
    }
  }, [active])

  /** The split's X buttons and the context menu's "Remove from split view".
   *  Closing ONE window of a split leaves the others standing: with pinned
   *  panes up, closing the live file promotes the OLDEST pin into the live
   *  slot and the terminal (if any) stays where it is. Only with nothing else
   *  on the file side does closing the file hand the terminal the full view;
   *  closing the TERMINAL pane always just leaves the files. */
  const closeFilePane = useCallback(() => {
    const first = active?.panes[0]
    if (active && first) {
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === s.activeId)
        if (!tab) return s
        return { ...s, tabs: setTabPanes(s.tabs, tab.id, unpinPane(tab.panes, first.id)) }
      })
      void window.prism.openWithin(active.root, first.path).then((p) => p && open(p))
      setPaneFocus('live')
      return
    }
    applyTermView((term, id) => (term ? { ...term, view: 'full' } : { id, view: 'full' }))
  }, [active, applyTermView, open])
  const closeTermPane = useCallback(
    () =>
      applyTermView((term, id) => (term ? { ...term, view: 'hidden' } : { id, view: 'hidden' })),
    [applyTermView]
  )

  /**
   * Split-view pins: "Open in split view" adds the file as a pane beside the
   * live one - agnostic of what else is showing, files beside files. The
   * direction is remembered, a bare click reuses it, and the fourth window
   * FIFO-evicts the oldest pin.
   */
  /**
   * Which window of a split the user is IN: the live pane, a pinned pane (by
   * id), or the terminal. The sidebar's selected row follows it - the file in
   * the focused window is the one marked, and a focused terminal marks none.
   * Tracked from real pointer-downs and focus, so it needs no plumbing through
   * the viewers: each region wears a data attribute and the listener resolves
   * the innermost one.
   */
  const [paneFocus, setPaneFocus] = useState<'live' | 'term' | string>('live')
  // Opening a file in split view refocuses the terminal panel as it re-docks;
  // that focus is mechanical, not the user choosing the shell, and must not
  // steal the selection from the file that was just opened.
  const ignoreTermFocusUntil = useRef(0)
  useEffect(() => {
    const resolve = (target: EventTarget | null): void => {
      const el = target instanceof Element ? target : null
      const region = el?.closest('[data-pane], [data-term-region]')
      if (!region) return
      if (region.hasAttribute('data-term-region')) {
        if (Date.now() >= ignoreTermFocusUntil.current) setPaneFocus('term')
        return
      }
      const kind = region.getAttribute('data-pane')
      if (kind === 'pinned') setPaneFocus(region.getAttribute('data-pane-id') ?? 'live')
      else setPaneFocus('live')
    }
    const down = (e: PointerEvent): void => resolve(e.target)
    const focus = (e: FocusEvent): void => resolve(e.target)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('focusin', focus, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('focusin', focus, true)
    }
  }, [])
  // The focused thing can vanish: its pane unpinned, the terminal hidden, the
  // tab switched. Focus falls back to the live pane rather than pointing at
  // nothing.
  useEffect(() => setPaneFocus('live'), [activeId])
  useEffect(() => {
    setPaneFocus((f) => {
      if (f === 'term') return active?.term && active.term.view !== 'hidden' ? f : 'live'
      if (f !== 'live' && !active?.panes.some((pn) => pn.id === f)) return 'live'
      return f
    })
  }, [active])

  const paneSeq = useRef(0)
  const pinSplit = useCallback(
    (path: string, dir?: SplitDir) => {
      const d = dir ?? lastSplitDir()
      saveSplitDir(d)
      // Over a FULL terminal, "open in split view" means: this file, beside
      // the shell. The terminal drops to its split, docked on the side
      // OPPOSITE the one picked for the file, and the file opens live -
      // nothing gets pinned, this is the terminal/file split.
      if (active && active.kind !== 'settings' && active.term?.view === 'full') {
        const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const
        pickDock(opposite[d])
        applyTermView((term, id) => (term ? { ...term, view: 'split' } : { id, view: 'split' }))
        void window.prism.openWithin(active.root, path).then((p) => p && open(p))
        // The just-opened file is the one selected, not the shell the re-dock
        // is about to mechanically refocus.
        ignoreTermFocusUntil.current = Date.now() + 800
        setPaneFocus('live')
        return
      }
      // A re-pin keeps its pane (pinPane moves it), so focus its EXISTING id.
      const already = active?.panes.find((pn) => pn.path.toLowerCase() === path.toLowerCase())
      const paneId = already?.id ?? `pane-${(paneSeq.current += 1)}`
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === s.activeId)
        if (!tab || tab.kind === 'settings') return s
        return { ...s, tabs: setTabPanes(s.tabs, tab.id, pinPane(tab.panes, paneId, path, d)) }
      })
      setPaneFocus(paneId) // the freshly pinned file is where the eye went
    },
    [active, applyTermView, open, pickDock]
  )
  const unpinSplitId = useCallback((paneId: string) => {
    setTabState((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeId)
      if (!tab) return s
      return { ...s, tabs: setTabPanes(s.tabs, tab.id, unpinPane(tab.panes, paneId)) }
    })
  }, [])
  const unpinSplitPath = useCallback((path: string) => {
    setTabState((s) => {
      const tab = s.tabs.find((t) => t.id === s.activeId)
      if (!tab) return s
      const hit = tab.panes.find((pn) => pn.path.toLowerCase() === path.toLowerCase())
      return hit ? { ...s, tabs: setTabPanes(s.tabs, tab.id, unpinPane(tab.panes, hit.id)) } : s
    })
  }, [])

  /** "Open in new tab": a fresh tab rooted at the file's folder, like an
   *  Explorer open would make, spawned unconditionally. */
  const openInNewTab = useCallback((path: string) => {
    // A FOLDER becomes a tab rooted there, a file a tab showing it: the tab
    // strip takes both now, since a folder dragged out of the tree is the
    // natural way to open one beside what you already have.
    void window.prism.statFile(path).then((st) => {
      void (st?.isFolder ? window.prism.openRoot(path) : window.prism.openPath(path)).then((p) => {
        if (p) setTabState((s) => addTab(s.tabs, p, nextTabId()))
      })
    })
  }, [])
  /** The terminal menu's version: a new tab on the same root, shell in front. */
  const openTermInNewTab = useCallback(() => {
    const root = active?.root
    if (!root) return
    void window.prism.openRoot(root).then((p) => {
      if (!p) return
      setTabState((s) => addTab(s.tabs, p, nextTabId()))
      setTabState((s) => {
        const tab = s.tabs.find((t) => t.id === s.activeId)
        if (!tab || tab.term) return s
        const termId = nextTermId()
        termRoots.current.set(termId, tab.root)
        return { ...s, tabs: setTabTerm(s.tabs, tab.id, { id: termId, view: 'full' }) }
      })
    })
  }, [active])

  const toggleFullscreen = useCallback(() => setFs(!fullscreen), [fullscreen, setFs])

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

  /* ------------------------------------------------------------------ *
   * Every tab holding media keeps its player, and the strip only decides
   * which one you can SEE (2026-08-27). Handing the sound to a second,
   * hidden element was audible - a pause and an unpause at every switch -
   * because nothing but the element itself surviving is seamless.
   *
   * The order is a ref rather than state on purpose: it is derived from the
   * tabs in the same pass that renders them, and it only ever appends, so
   * there is nothing for a re-render to settle.
   * ------------------------------------------------------------------ */
  const deckOrder = useRef<string[]>([])
  const deck = useMemo(() => {
    const next = deckOf(tabs, deckOrder.current, activeId)
    deckOrder.current = next.order
    return next.entries
  }, [tabs, activeId])

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
  /**
   * The next (or previous) file of the SAME KIND, stepping over everything
   * else - what autoplay does at the end of a video, and what the video's own
   * right-click menu offers as Next / Previous (2026-08-27).
   *
   * Returns the index it would land on, or -1: the menu greys its rows out
   * with the same answer it would act on, so a row is never offered when
   * there is nothing on the other side of it.
   */
  const sameKindIndex = useCallback(
    (dir: 1 | -1): number => {
      if (!view) return -1
      const current = view.files[view.index]
      if (!current) return -1
      for (let i = view.index + dir; i >= 0 && i < view.files.length; i += dir) {
        if (view.files[i].kind === current.kind) return i
      }
      return -1
    },
    [view]
  )
  const stepSameKind = useCallback(
    (dir: 1 | -1) => {
      const i = sameKindIndex(dir)
      if (i < 0 || !active || !view) return
      const next = view.files[i]
      // The playlist carries its own intent (2026-08-28). Nothing autoplays on
      // open any more, so the file a finished video hands over to - and the
      // one the menu's Next reaches for while you are watching - has to say
      // "I was already playing" on its own behalf. Stepping away from a file
      // you had PAUSED lands paused, which is the same rule.
      if (file && wasPlaying(window.prism.mediaUrl(file.path)))
        intendToPlay(window.prism.mediaUrl(next.path))
      setRawIndex(active.files.indexOf(next))
    },
    [active, file, sameKindIndex, setRawIndex, view]
  )
  const advanceSameKind = useCallback(() => stepSameKind(1), [stepSameKind])

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
    (p: string) =>
      void (
        active &&
        window.prism.openWithin(active.root, p).then((payload) => payload && open(payload))
      ),
    [active, open]
  )

  /* Undo and redo (2026-08-22), for the things Prism WRITES: moving,
     renaming, binning and duplicating. The text editor keeps its own Ctrl+Z
     inside a focused document; this stack only sees the file operations. */
  const [undoState, setUndoState] = useState<UndoState>(emptyUndo)
  // Undo is otherwise invisible when the change is off screen, so it says what
  // it did for a moment. Deliberately not a dialog: nothing to answer.
  const [undoNote, setUndoNote] = useState<string | null>(null)
  const noteTimer = useRef<number | null>(null)
  const flashUndo = useCallback((text: string): void => {
    setUndoNote(text)
    if (noteTimer.current) window.clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setUndoNote(null), 2600)
  }, [])
  const noteUndo = useCallback((entry: UndoEntry) => setUndoState((u) => remember(u, entry)), [])

  const runRename = useCallback(
    async (path: string, name: string, onClash: OnClash, track = true): Promise<string | null> => {
      const r = await window.prism.renameFile(path, name, onClash)
      if (!r.ok) {
        if (r.reason === 'clash')
          setAsk({ kind: 'clash', path, name, suggestion: r.suggestion ?? name })
        else setAsk({ kind: 'failed', message: r.message ?? 'That could not be renamed.' })
        return null
      }
      setAsk(null)
      setRefreshKey((n) => n + 1)
      if (track !== false)
        noteUndo({ kind: 'rename', from: path, to: r.path, replaced: r.replaced })
      // Follow whatever is on screen: it may have been the thing renamed, or a
      // file inside the folder that was, in which case its path just moved.
      const cur = file?.path
      if (!cur) return r.path
      if (within(cur, path)) reopen(r.path + cur.slice(path.length))
      else reopen(cur)
      return r.path
    },
    [file, noteUndo, reopen]
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
      noteUndo({ kind: 'trash', paths: [path] })
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
    [closeActiveTab, file, noteUndo, reopen, view]
  )
  /** The multi-selection's delete (2026-08-22): every path to the bin, one
   *  refresh, and the viewer steps off anything that just vanished. */
  const runDeleteMany = useCallback(
    async (paths: string[]): Promise<void> => {
      setAsk(null)
      const binned: string[] = []
      for (const p of paths) {
        if (await window.prism.trashFile(p)) binned.push(p)
      }
      const failed = paths.length - binned.length
      setRefreshKey((n) => n + 1)
      // Only the ones that really went: undoing a path that never left would
      // restore a file the user deliberately binned earlier.
      if (binned.length) noteUndo({ kind: 'trash', paths: binned })
      const cur = file?.path
      if (cur && paths.some((p) => within(cur, p))) {
        const survivors = view?.files.filter((f) => !paths.some((p) => within(f.path, p))) ?? []
        const next = survivors[Math.min(view?.index ?? 0, survivors.length - 1)]
        if (next) reopen(next.path)
        else closeActiveTab()
      } else if (cur) reopen(cur)
      if (failed)
        setAsk({
          kind: 'failed',
          message: `${failed} of ${paths.length} could not be moved to the Recycle Bin.`
        })
    },
    [closeActiveTab, file, noteUndo, reopen, view]
  )

  /** A drop landed on a folder (#70): files move in, archive members extract
   *  there. Moving asks about taken names before it touches anything. */
  const runMove = useCallback(
    async (
      paths: string[],
      dest: string,
      mode: 'ask' | 'keep-both' | 'replace',
      track = true
    ): Promise<Array<{ from: string; to: string }>> => {
      const r = await window.prism.moveEntries(paths, dest, mode)
      if (mode === 'ask' && r.clashes.length) {
        setAsk({ kind: 'move-clash', paths, dest, names: r.clashes.map((c) => c.name) })
        return []
      }
      setAsk(null)
      setRefreshKey((n) => n + 1)
      if (track && r.moved.length)
        noteUndo({
          kind: 'move',
          items: r.moved,
          replaced: r.replaced?.length ? r.replaced : undefined
        })
      // Follow the open file FIRST, whatever else failed: it may have been
      // inside a folder that moved, in which case only its prefix changed.
      const cur = file?.path
      if (cur) {
        const landed = r.moved.find((m) => within(cur, m.from))
        if (landed) reopen(landed.to + cur.slice(landed.from.length))
      }
      if (r.failed.length)
        setAsk({
          kind: 'failed',
          message: r.refused
            ? 'Those can only be moved inside the folder Prism opened, and a tab\u2019s own folder cannot be moved.'
            : `${r.failed.length} of ${paths.length} could not be moved.`
        })
      return r.moved
    },
    [file, noteUndo, reopen]
  )

  /** Reverse one action. Undo never asks: it puts things back beside whatever
   *  has appeared in the meantime rather than overwriting it. */
  const applyUndo = useCallback(
    async (entry: UndoEntry): Promise<UndoEntry | void> => {
      switch (entry.kind) {
        case 'move': {
          // Undo lands beside whatever appeared meanwhile, so the file may now
          // sit under a "(2)" name. The entry is corrected to where it REALLY
          // is, or a redo would move a stranger.
          const items: Array<{ from: string; to: string }> = []
          for (const it of entry.items) {
            const [back] = await runMove([it.to], parentDir(it.from), 'keep-both', false)
            items.push(back ? { from: back.to, to: it.to } : it)
          }
          // The name is free again only now, so the replaced file comes back
          // after the mover has left, not before.
          if (entry.replaced?.length) await window.prism.restoreFromBin(entry.replaced)
          setRefreshKey((n) => n + 1)
          return { ...entry, items, replaced: undefined }
        }
        case 'rename': {
          const back = await runRename(entry.to, baseName(entry.from), 'keep-both', false)
          if (entry.replaced) await window.prism.restoreFromBin([entry.replaced])
          setRefreshKey((n) => n + 1)
          return back ? { ...entry, from: back, replaced: undefined } : entry
        }
        case 'trash': {
          const ok = await window.prism.restoreFromBin(entry.paths)
          setRefreshKey((n) => n + 1)
          if (!ok)
            setAsk({
              kind: 'failed',
              message:
                'Windows would not give those back. They may have been emptied from the Recycle Bin.'
            })
          break
        }
        case 'duplicate':
          if (!(await window.prism.trashFile(entry.path)))
            setAsk({ kind: 'failed', message: 'That copy could not be moved to the Recycle Bin.' })
          setRefreshKey((n) => n + 1)
          break
        case 'archive-in': {
          // Both halves: the members leave the zip, the originals come back.
          // A folder member has no entry of its own, which deleteMember now
          // handles by taking its subtree; a refusal is worth saying out loud
          // rather than leaving a copy behind silently.
          let stuck = 0
          for (const e of entry.entries) {
            if (!(await window.prism.archiveDelete(entry.zip, e))) stuck += 1
          }
          if (entry.originals.length) await window.prism.restoreFromBin(entry.originals)
          setRefreshKey((n) => n + 1)
          if (stuck)
            setAsk({
              kind: 'failed',
              message: `${stuck} of ${entry.entries.length} could not be taken back out of the archive.`
            })
          break
        }
      }
    },
    [runMove, runRename]
  )
  /** Do one again, after it was undone. */
  const applyRedo = useCallback(
    async (entry: UndoEntry): Promise<UndoEntry | void> => {
      switch (entry.kind) {
        case 'move': {
          const items: Array<{ from: string; to: string }> = []
          for (const it of entry.items) {
            const [again] = await runMove([it.from], parentDir(it.to), 'keep-both', false)
            items.push(again ? { from: it.from, to: again.to } : it)
          }
          return { ...entry, items }
        }
        case 'rename': {
          const again = await runRename(entry.from, baseName(entry.to), 'keep-both', false)
          return again ? { ...entry, to: again } : entry
        }
        case 'trash':
          for (const p of entry.paths) await window.prism.trashFile(p)
          setRefreshKey((n) => n + 1)
          break
        case 'duplicate': {
          // Ask the SOURCE for another copy and remember the one it made: the
          // name is chosen by the folder, not by us.
          const copy = await window.prism.duplicateFile(entry.source)
          setRefreshKey((n) => n + 1)
          if (!copy) {
            setAsk({ kind: 'failed', message: 'That could not be duplicated again.' })
            break
          }
          return { ...entry, path: copy }
        }
        case 'archive-in': {
          const r = await window.prism.archiveAdd(entry.zip, entry.originals, entry.dest, true)
          if (r === 'encrypted' || r === 'failed') {
            setAsk({
              kind: 'failed',
              message: 'That archive could not be written, so nothing was moved into it.'
            })
            break
          }
          // Bin only what actually landed - never the whole wish list - and
          // remember the member names keep-both actually used.
          for (const a of r.added) await window.prism.trashFile(a.src)
          setRefreshKey((n) => n + 1)
          return {
            ...entry,
            entries: r.added.map((a) => a.entry),
            originals: r.added.map((a) => a.src)
          }
        }
      }
    },
    [runMove, runRename]
  )
  // One at a time. Restoring from the Recycle Bin spawns PowerShell and takes
  // half a second; a held Ctrl+Z would otherwise run the next inverse against
  // a file the previous one has not put back yet.
  const undoChain = useRef<Promise<void>>(Promise.resolve())
  /** An inverse can land somewhere else than it left (a taken name). Patching
   *  the entry by identity keeps the OTHER direction honest. */
  const patchEntry = useCallback((was: UndoEntry, now: UndoEntry): void => {
    setUndoState((u) => ({
      past: u.past.map((e) => (e === was ? now : e)),
      future: u.future.map((e) => (e === was ? now : e))
    }))
  }, [])
  const queueUndo = useCallback(
    (entry: UndoEntry, run: () => Promise<UndoEntry | void>): void => {
      undoChain.current = undoChain.current
        .then(async () => {
          const corrected = await run()
          if (corrected) patchEntry(entry, corrected)
        })
        .catch(() => {})
    },
    [patchEntry]
  )
  const undo = useCallback((): void => {
    const step = undone(undoState)
    if (!step) {
      flashUndo('Nothing to undo')
      return
    }
    setUndoState(step.state)
    flashUndo(`Undid ${describeUndo(step.entry)}`)
    queueUndo(step.entry, () => applyUndo(step.entry))
  }, [applyUndo, flashUndo, queueUndo, undoState])
  const redo = useCallback((): void => {
    const step = redone(undoState)
    if (!step) {
      flashUndo('Nothing to redo')
      return
    }
    setUndoState(step.state)
    flashUndo(`Redid ${describeUndo(step.entry)}`)
    queueUndo(step.entry, () => applyRedo(step.entry))
  }, [applyRedo, flashUndo, queueUndo, undoState])
  const onDropInto = useCallback(
    (dest: string, payload: DragPayload): void => {
      if (payload.kind === 'files') {
        void runMove(payload.paths, dest, 'ask')
        return
      }
      // Members out of an archive: extracted where they were dropped, with the
      // password the archive view already asked for, if it needed one.
      void window.prism
        .archiveExtractTo(payload.archive, payload.entries, dest, archivePassword(payload.archive))
        .then((r) => {
          if (r.ok) setRefreshKey((n) => n + 1)
          else
            setAsk({
              kind: 'failed',
              message:
                r.reason === 'password'
                  ? 'That archive is password protected. Open one of its files first to unlock it, then drag again.'
                  : "Those members couldn't be extracted here."
            })
        })
    },
    [runMove]
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
      // tab-management hotkeys (Ctrl+T/W/Tab/digits) and Ctrl+B (sidebar)
      // still belong to Prism there, by request - which does cost the shell
      // Ctrl+W (delete-word) and Ctrl+B (vim page-up, tmux's prefix). The
      // keys shells truly live on - Ctrl+C, Ctrl+D (EOF), Ctrl+S (XOFF),
      // Escape, the arrows - stay the shell's; only the search box, a rename
      // and the text editor keep the full typing shield.
      const inTerm = !!el && !!el.closest('.xterm')
      // The setup owns the window while it is up: none of these should reach the
      // app behind it, least of all Escape, which would close Prism mid-guide.
      if (setup) return
      if (e.key === 'F11') {
        e.preventDefault()
        setFs(!fullscreen)
      } else if (e.ctrlKey && !typing && !inTerm && !fullscreen && /^[zy]$/i.test(e.key)) {
        // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) undo Prism's OWN writes. Behind
        // the typing guard, so the text editor and the shell keep their own -
        // and behind FULLSCREEN (2026-08-28), where the tree and its verbs are
        // not on screen: a keystroke that moves files about while you cannot
        // see them is a change you did not mean to make.
        e.preventDefault()
        if (e.key.toLowerCase() === 'y' || e.shiftKey) redo()
        else undo()
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
      } else if (
        (e.code === 'KeyT' || e.key === 't' || e.key === 'T') &&
        e.ctrlKey &&
        (!typing || inTerm)
      ) {
        e.preventDefault()
        newTab()
      } else if (
        (e.code === 'KeyW' || e.key === 'w' || e.key === 'W') &&
        e.ctrlKey &&
        (!typing || inTerm)
      ) {
        // Close the innermost thing first: split panes pop LIFO (tabs within
        // the tab), and only with none left does Ctrl+W reach the tab itself.
        // It still never takes the window on the last tab: Prism is resident,
        // and a window that vanishes under a reflex keystroke - with unsaved
        // text in it - is the failure the close flow exists to prevent.
        e.preventDefault()
        if (active && active.panes.length > 0) {
          unpinSplitId(active.panes[active.panes.length - 1].id)
        } else {
          closeActiveTab()
        }
      } else if (e.key === 'Tab' && e.ctrlKey && (!typing || inTerm)) {
        e.preventDefault()
        stepTab(e.shiftKey ? -1 : 1)
      } else if (e.ctrlKey && (!typing || inTerm) && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        jumpTab(Number(e.key))
      } else if (
        (e.code === 'KeyB' || e.key === 'b' || e.key === 'B') &&
        e.ctrlKey &&
        (!typing || inTerm)
      ) {
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
        if (fullscreen) setFs(false)
        else window.prism.close()
      } else if ((e.key === 'PageDown' || e.key === 'PageUp') && !typing && termView !== 'full') {
        // Same rule as the arrows: the document has these only once it has
        // been focused. Reading a pdf from the sidebar should page the folder.
        if (docFocused()) return
        go(e.key === 'PageDown' ? 1 : -1)
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing && termView !== 'full') {
        // FOCUS decides, for every kind. A document owns the vertical keys only
        // while it is focused - click into it, or Tab to it. Until then it has
        // no more claim on them than a photo does, so arrowing through a folder
        // from the sidebar behaves the same whatever kind of file it lands on.
        // (`typing` already covered the text editor's caret, above.)
        if (docFocused()) return
        // The tree gets first refusal: it walks folders as well as files, and
        // says no when it isn't there to walk.
        const dir = e.key === 'ArrowDown' ? 'down' : 'up'
        if (!fullscreen && treeNav.current?.(dir)) {
          e.preventDefault()
          return
        }
        // Nothing to walk, and a player in front of you: Up/Down are the
        // VOLUME, which is what every media player has taught (2026-08-30).
        // They used to be preventDefault-ed unconditionally here, and
        // useMediaControls yields on defaultPrevented, so the volume keys were
        // dead everywhere - most obviously in fullscreen, where the sidebar is
        // gone and there is nothing else for them to do. The player only gets
        // them when the tree does not want them, so browsing a folder from the
        // sidebar is unchanged.
        if (!!file && PLAYABLE.has(file.kind)) return // player handles it
        e.preventDefault()
        go(e.key === 'ArrowDown' ? 1 : -1)
      } else if (
        (e.key === 'ArrowRight' || e.key === 'ArrowLeft') &&
        !typing &&
        termView !== 'full'
      ) {
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
  }, [
    active,
    closeActiveTab,
    file,
    fullscreen,
    go,
    hasNavigated,
    jumpTab,
    newTab,
    openTermFull,
    redo,
    settingsOpen,
    setup,
    stepTab,
    termView,
    togglePanel,
    toggleTerm,
    undo,
    unpinSplitId
  ])

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
      // Prism's own rows carry paths in the payload, not as files. Dropping
      // one on the viewer means "show me this": a file opens here, a folder
      // becomes this tab's root. Archive members are not on disk, so they
      // are left to the archive view that owns them.
      const inside = dragPayload(e.dataTransfer)
      setDrag(null)
      if (inside?.kind === 'files') {
        const first = inside.paths[0]
        if (!first) return
        void window.prism.statFile(first).then((st) => {
          if (st?.isFolder)
            void window.prism.openRoot(first).then((p) => p && applyReroot(activeIdRef.current, p))
          else void window.prism.openPath(first).then(open)
        })
        return
      }
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
  }, [applyReroot, open, setup])

  // The style's light belongs to an empty window, a visualizer, or a page of
  // Prism's own - never behind someone's photo.
  const washed = settingsOpen || setup || !file || file.kind === 'audio'

  const many = (view?.files.length ?? 0) > 1
  // No folder position over a FULL terminal either: it counts a file that
  // isn't on screen.
  const pos = many && termView !== 'full' ? `${view!.index + 1} / ${view!.files.length}` : ''

  // Fullscreen is for watching, not browsing: no tree, no arrows, no chrome.
  // Outside fullscreen the panel stays mounted even when closed, so it can slide.
  return (
    <div className="flex h-full flex-col text-[var(--p-text)] [font-size:var(--p-size)]">
      {!fullscreen && (
        <TopBar
          // The tree already names (and highlights) the open file; the bar only
          // repeats it when the tree isn't there to say it. A FULL terminal
          // names nothing: the file it would name is not what's on screen.
          name={
            (sidebar && active && !settingsOpen) || termView === 'full' ? '' : (file?.name ?? '')
          }
          pos={pos}
          settingsOpen={settingsOpen}
          onToggleSettings={toggleSettings}
          panelOpen={settingsOpen ? !compactRail : sidebar}
          onTogglePanel={togglePanel}
          setup={setup}
          wash={washed}
          // Only markdown takes the pencil. Code and plain text have no
          // rendered form to leave, so they are simply editable where they sit.
          // A FULL terminal hides it: the document is not on screen to edit,
          // the same reason the bar drops the file's name there.
          editable={termView !== 'full' && file?.kind === 'text' && isMarkdown(file.name)}
          editing={editMode}
          dirty={dirtyPaths.size > 0}
          onToggleEdit={() => setEditMode((v) => !v)}
          update={update}
          updatePhase={updatePhase}
          updatePct={updatePct}
          onInstallUpdate={installUpdate}
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
          workingIds={workingIds}
          doneIds={doneIds}
          agentIds={agentIds}
          onDropFile={openInNewTab}
          onReorder={reorderTab}
          onOpenRecent={openRecent}
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
        {active && active.kind !== 'settings' && !fullscreen && (
          <Sidebar
            open={sidebar}
            root={active.root}
            onOpenFolder={rerootHere}
            onToggleTerm={toggleTerm}
            termOpen={termView !== 'hidden'}
            onPinSplit={pinSplit}
            onUnpinSplit={unpinSplitPath}
            pinnedPaths={active.panes.map((pn) => pn.path)}
            onOpenNewTab={openInNewTab}
            onTermNewTab={openTermInNewTab}
            onTermSplit={openTermSplit}
            onClearTerm={active.term ? clearTerm : null}
            state={active.tree}
            onTree={onTree}
            // The selected row follows what is ON SCREEN: a pinned pane marks
            // its file, the terminal marks nothing - in a split when it holds
            // the focus, and in FULL view always, where the viewer is not
            // showing anything at all - and otherwise the open file.
            currentPath={
              paneFocus === 'term' || termView === 'full'
                ? null
                : (active.panes.find((pn) => pn.id === paneFocus)?.path ?? file?.path ?? null)
            }
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
            onDeleteMany={(paths) => setAsk({ kind: 'delete-many', paths })}
            onDropInto={onDropInto}
            onDuplicated={(source, copy) => noteUndo({ kind: 'duplicate', source, path: copy })}
            wash={washed}
          />
        )}
        <div className="flex min-w-0 min-h-0 flex-1" style={{ flexDirection: dockFlex(dockEdge) }}>
          <div
            className={`group relative flex min-w-0 min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--p-bg)] ${
              washed ? 'p-wash' : ''
            } ${dragging ? 'ring-2 ring-inset ring-[var(--p-accent)]' : ''} ${
              // Full view: the terminal takes the whole area, but the viewer
              // stays MOUNTED so scroll, zoom and playback survive the visit -
              // the same reason hidden shells stay alive.
              termView === 'full' ? 'hidden' : ''
            }`}
            ref={viewerBox}
          >
            {/* the fullscreen fade-to-black, inside the fullscreen element */}
            <div
              ref={fsVeilEl}
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[200] bg-black opacity-0 will-change-[opacity]"
            />
            {/* Keyed by KIND, not by path. Keying by path remounted the viewer on
              every arrow press, which threw the current picture away before the
              next one had decoded and flashed the window black between them.
              A viewer keeps itself in order across files of its own kind; only
              a change of kind needs a fresh one. */}
            {(() => {
              // The tabs' own players, all of them mounted, only one on screen.
              // Absolutely placed so the hidden ones take no room and the
              // visible one fills the pane exactly as a viewer always did.
              const activeDeck = deck.find((e) => e.tabId === activeId) ?? null
              const players = deck.map((e) => (
                <div
                  key={e.tabId}
                  aria-hidden={e.tabId === activeId ? undefined : true}
                  className={
                    e.tabId === activeId
                      ? 'absolute inset-0'
                      : 'pointer-events-none absolute left-0 top-0 h-px w-px overflow-hidden opacity-0'
                  }
                >
                  <Viewer
                    file={e.file}
                    background={e.tabId !== activeId}
                    volumeKey={e.tabId}
                    onUndoable={noteUndo}
                    onRenameSelf={(name) => void runRename(e.file.path, name, 'ask')}
                    refreshKey={refreshKey}
                    onToggleFullscreen={toggleFullscreen}
                    fullscreen={fullscreen}
                    transportStyle={transportStyle}
                    transportBg={transportBg}
                    onOpenLocal={openFromTree}
                    // A tab you are not looking at does not choose what plays
                    // next: autoplay and the menu's Next belong to the front.
                    onAutoAdvance={e.tabId === activeId ? advanceSameKind : () => {}}
                    onStep={e.tabId === activeId ? stepSameKind : () => {}}
                    canStep={(dir) => (e.tabId === activeId ? sameKindIndex(dir) >= 0 : false)}
                    onBuffer={onBuffer}
                    getPending={getPending}
                  />
                </div>
              ))
              const liveContent =
                file && editMode && file.kind === 'text' ? (
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
                ) : activeDeck ? null : file ? (
                  <Viewer
                    key={`${file.kind}:${docVersion}`}
                    file={file}
                    onUndoable={noteUndo}
                    onRenameSelf={(name) => void runRename(file.path, name, 'ask')}
                    refreshKey={refreshKey}
                    onToggleFullscreen={toggleFullscreen}
                    fullscreen={fullscreen}
                    transportStyle={transportStyle}
                    transportBg={transportBg}
                    onOpenLocal={openFromTree}
                    onAutoAdvance={advanceSameKind}
                    onStep={stepSameKind}
                    canStep={(dir) => sameKindIndex(dir) >= 0}
                    onBuffer={onBuffer}
                    getPending={getPending}
                  />
                ) : active ? (
                  <NoFileState />
                ) : (
                  <EmptyState onOpen={browse} onOpenFolder={rerootHere} />
                )
              const pins = active?.panes ?? []
              const withPlayers = (
                <>
                  {players}
                  {liveContent}
                </>
              )
              if (!pins.length || fullscreen) return withPlayers
              // The quadrant grid: the live pane plus up to three pinned files,
              // hairline-separated, one window per corner at the full four.
              const areas = paneAreas(pins)
              return (
                <div
                  className="grid h-full w-full gap-px bg-[var(--p-divider)]"
                  style={{ gridTemplateRows: '1fr 1fr', gridTemplateColumns: '1fr 1fr' }}
                >
                  <div
                    data-pane="live"
                    className="group/live relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-[var(--p-bg)]"
                    style={{ gridArea: areas.live }}
                  >
                    {withPlayers}
                    {/* Its own X, like every pinned pane: closing the live
                      window promotes the oldest pin, the rest stand. */}
                    <button
                      className="no-drag absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded bg-black/30 text-[var(--p-icon)] opacity-0 transition-opacity hover:bg-black/50 hover:text-[var(--p-text)] focus-visible:opacity-100 group-hover/live:opacity-100"
                      onClick={closeFilePane}
                      title="Remove from split view"
                      aria-label="Remove the open file from split view"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width={11}
                        height={11}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        aria-hidden
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                  {pins.map((pn, i) => (
                    <PinnedPaneView
                      key={pn.id}
                      paneId={pn.id}
                      path={pn.path}
                      area={areas.pinned[i]}
                      onClose={() => unpinSplitId(pn.id)}
                      viewerProps={{
                        onUndoable: noteUndo,
                        // A pinned pane renames the file IT holds, not the one
                        // in the main viewer.
                        onRenameSelf: (name: string) => void runRename(pn.path, name, 'ask'),
                        refreshKey,
                        onToggleFullscreen: toggleFullscreen,
                        fullscreen,
                        transportStyle,
                      transportBg,
                        onOpenLocal: openFromTree,
                        onAutoAdvance: () => {},
                      onStep: () => {},
                      canStep: () => false,
                        onBuffer,
                        getPending,
                        volumeKey: `${activeId ?? ''}:pin:${pn.path}`
                      }}
                    />
                  ))}
                </div>
              )
            })()}
            {/* No on-screen arrows: paging is the keyboard's job. Left and right,
              up and down, PageUp and PageDown, in or out of fullscreen. */}
            {/* The region-level X only when the region IS one window: with the
              pane grid up, each window carries its own. */}
            {termView === 'split' && !fullscreen && !active?.panes.length && (
              <button
                className="no-drag absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded bg-black/30 text-[var(--p-icon)] opacity-0 transition-opacity hover:bg-black/50 hover:text-[var(--p-text)] focus-visible:opacity-100 group-hover:opacity-100"
                onClick={closeFilePane}
                title="Remove from split view"
                aria-label="Remove the file from the split"
              >
                <svg
                  viewBox="0 0 24 24"
                  width={11}
                  height={11}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden
                >
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
          closeSettingsTab()
          setSetup(true)
        }}
        compactRail={compactRail}
        onClose={closeSettingsTab}
        transportStyle={transportStyle}
        onPickTransport={pickTransport}
        transportBg={transportBg}
        onPickTransportBg={pickTransportBg}
      />

      {ask?.kind === 'delete' && (
        <Dialog
          title="Move to the Recycle Bin?"
          body={
            <>
              <span className="text-[#d7dae1]">{ask.name}</span> goes to the Recycle Bin, where
              Windows can put it back.
            </>
          }
          onCancel={() => setAsk(null)}
          choices={[
            { label: 'Cancel', onPick: () => setAsk(null) },
            { label: 'Delete', danger: true, primary: true, onPick: () => void runDelete(ask.path) }
          ]}
        />
      )}

      {ask?.kind === 'delete-many' && (
        <Dialog
          title={`Move ${ask.paths.length} items to the Recycle Bin?`}
          body="Everything selected goes to the Recycle Bin, where Windows can put it back."
          onCancel={() => setAsk(null)}
          choices={[
            { label: 'Cancel', onPick: () => setAsk(null) },
            {
              label: 'Delete',
              danger: true,
              primary: true,
              onPick: () => void runDeleteMany(ask.paths)
            }
          ]}
        />
      )}

      {/* What undo just did, said quietly and briefly: the change is often
          off screen, and a dialog would be asking a question nobody has. */}
      {undoNote && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-3.5 py-1.5 text-[12px] text-[var(--p-text-soft)] shadow-[0_10px_28px_rgba(0,0,0,.45)]"
        >
          {undoNote}
        </div>
      )}

      {ask?.kind === 'move-clash' && (
        <Dialog
          title={
            ask.names.length > 1
              ? `${ask.names.length} names are already taken`
              : `"${ask.names[0]}" is already there`
          }
          body="Keep both lands them beside what is there; replacing sends the old ones to the Recycle Bin."
          onCancel={() => setAsk(null)}
          choices={[
            { label: 'Cancel', onPick: () => setAsk(null) },
            {
              label: 'Keep both',
              primary: true,
              onPick: () => void runMove(ask.paths, ask.dest, 'keep-both')
            },
            {
              label: 'Replace',
              danger: true,
              onPick: () => void runMove(ask.paths, ask.dest, 'replace')
            }
          ]}
        />
      )}

      {ask?.kind === 'close-dirty' && (
        <Dialog
          title={
            unsavedNames.length > 1
              ? `${unsavedNames.length} files have unsaved changes`
              : 'Unsaved changes'
          }
          body={
            <>
              <span className="text-[#d7dae1]">{unsavedNames.join(', ') || 'This file'}</span>
              {unsavedNames.length > 1
                ? ' are not on disk yet.'
                : ' has changes that are not on disk yet.'}{' '}
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
                const then = ask.kind === 'close-dirty' ? ask.then : undefined
                buffers.current.clear()
                syncDirty()
                setAsk(null)
                if (then === 'install') runInstall()
                else window.prism.close(true)
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
                  const then = ask.kind === 'close-dirty' ? ask.then : undefined
                  setAsk(null)
                  if (then === 'install') runInstall()
                  else window.prism.close(true)
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
          title={
            ask.names.length > 1
              ? `${ask.names.length} files have unsaved changes`
              : 'Unsaved changes'
          }
          body={
            <>
              <span className="text-[#d7dae1]">{ask.names.join(', ')}</span>
              {ask.names.length > 1
                ? ' are not on disk yet.'
                : ' has changes that are not on disk yet.'}{' '}
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
          title={
            ask.names.length > 1
              ? `${ask.names.length} files have unsaved changes`
              : 'Unsaved changes'
          }
          body={
            <>
              <span className="text-[#d7dae1]">{ask.names.join(', ')}</span>
              {ask.names.length > 1
                ? ' are not on disk yet.'
                : ' has changes that are not on disk yet.'}{' '}
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
              This folder already has a <span className="text-[#d7dae1]">{ask.name}</span>. Keeping
              both saves yours as <span className="text-[#d7dae1]">{ask.suggestion}</span>;
              replacing it sends the old one to the Recycle Bin.
            </>
          }
          onCancel={() => setAsk(null)}
          choices={[
            { label: 'Cancel', onPick: () => setAsk(null) },
            {
              label: 'Replace',
              danger: true,
              onPick: () => void runRename(ask.path, ask.name, 'overwrite')
            },
            {
              label: 'Keep both',
              primary: true,
              onPick: () => void runRename(ask.path, ask.name, 'keep-both')
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
