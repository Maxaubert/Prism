import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { OnClash, OpenPayload, ViewerFile } from '@shared/types'
import { preloadImage } from './lib/imageLoader'
import { scopeFiles, useNavScope } from './lib/navScope'
import { VideoView } from './components/VideoView'
import { AudioView } from './components/AudioView'
import { ImageView } from './components/ImageView'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { Dialog } from './components/Dialog'
import { loadTransportStyle, TRANSPORT_KEY, type TransportStyle } from './lib/transport'

// Phase 0/1 shell: a dark frameless window that opens a file (launch arg, drag,
// or dialog), routes by kind to a viewer, and pages through the folder. Video,
// audio, and image are the built "perfect" viewers; pdf/text are still stubs and
// get their own phase. All viewers eventually come from prism-core.

const PLAYABLE = new Set(['video', 'audio'])
const PRELOAD_MAX_BYTES = 80 * 1024 * 1024 // don't warm neighbours bigger than this
const SIDEBAR_KEY = 'prism.sidebar'

/** A question Prism has to put to the user before (or instead of) touching a file. */
type Ask =
  | { kind: 'delete'; path: string; name: string; isFolder: boolean }
  | { kind: 'clash'; path: string; name: string; suggestion: string }
  | { kind: 'failed'; message: string }

function TopBar({
  file,
  pos,
  settingsOpen,
  onToggleSettings,
  sidebar,
  onToggleSidebar
}: {
  file: ViewerFile | null
  pos: string
  settingsOpen: boolean
  onToggleSettings: () => void
  sidebar: boolean
  onToggleSidebar: () => void
}): JSX.Element {
  const w = window.prism
  return (
    <div className="drag flex h-9 shrink-0 items-center gap-3 border-b border-[var(--p-divider)] bg-[var(--p-title)] px-3 text-[13px]">
      <button
        className={`no-drag grid h-7 w-8 place-items-center rounded transition-colors hover:bg-white/10 ${
          sidebar ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-icon)] hover:text-[var(--p-text)]'
        }`}
        onClick={onToggleSidebar}
        title="Files (Ctrl+B)"
        aria-label="Toggle file tree"
        aria-pressed={sidebar}
      >
        <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      </button>
      <span className="font-semibold text-[var(--p-accent-hi)]">Prism</span>
      <span className="min-w-0 flex-1 truncate text-[var(--p-dim)]">{file ? file.name : ''}</span>
      {pos && <span className="text-[var(--p-dim)]">{pos}</span>}
      <div className="no-drag flex items-center gap-1">
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
        <button className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]" onClick={() => w.minimize()}>–</button>
        <button className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]" onClick={() => w.toggleMaximize()}>▢</button>
        <button className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-red-500/80 hover:text-white" onClick={() => w.close()}>✕</button>
      </div>
    </div>
  )
}

function TextViewer({ path }: { path: string }): JSX.Element {
  const [text, setText] = useState<string>('')
  useEffect(() => {
    void window.prism.readText(path).then((t) => setText(t ?? '(could not read file)'))
  }, [path])
  return (
    <pre className="h-full w-full overflow-auto bg-[var(--p-bg)] p-6 font-mono text-[13px] leading-relaxed text-[var(--p-text-soft)] select-text">
      {text}
    </pre>
  )
}

function Viewer({
  file,
  onToggleFullscreen,
  fullscreen,
  transportStyle
}: {
  file: ViewerFile
  onToggleFullscreen: () => void
  fullscreen: boolean
  transportStyle: TransportStyle
}): JSX.Element {
  const url = window.prism.mediaUrl(file.path)
  switch (file.kind) {
    case 'video':
      return <VideoView url={url} onToggleFullscreen={onToggleFullscreen} transportStyle={transportStyle} />
    case 'image':
      return <ImageView url={url} name={file.name} onToggleFullscreen={onToggleFullscreen} />
    case 'audio':
      return <AudioView url={url} name={file.name} fullscreen={fullscreen} onToggleFullscreen={onToggleFullscreen} transportStyle={transportStyle} />
    case 'pdf':
      return <embed src={url} type="application/pdf" className="h-full w-full" />
    case 'text':
      return <TextViewer path={file.path} />
    default:
      return <div className="text-[var(--color-dim)]">Can&apos;t preview this file type yet.</div>
  }
}

function NavArrow({ dir, onClick }: { dir: 'l' | 'r'; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`no-drag absolute top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/60 group-hover:opacity-100 ${dir === 'l' ? 'left-3' : 'right-3'}`}
    >
      {dir === 'l' ? '‹' : '›'}
    </button>
  )
}

function EmptyState({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--p-accent)]/20 text-3xl text-[var(--p-accent-hi)]">◇</div>
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
  // The file tree. Off on a fresh install: the media is the point.
  const [sidebar, setSidebar] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1')
  const toggleSidebar = useCallback(() => {
    setSidebar((on) => {
      localStorage.setItem(SIDEBAR_KEY, on ? '0' : '1')
      return !on
    })
  }, [])
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
  const openFromTree = useCallback((p: string) => void window.prism.openWithin(p).then(open), [open])

  const toggleFullscreen = useCallback(() => window.prism.setFullscreen(!fullscreen), [fullscreen])

  // The visible list: the siblings that belong with the open file under the
  // current scope, and its position among them.
  const scope = useNavScope()
  const view = useMemo(() => (raw ? scopeFiles(raw.files, rawIndex, scope) : null), [raw, rawIndex, scope])

  const go = useCallback(
    (delta: number) => {
      if (!raw || !view) return
      const next = Math.max(0, Math.min(view.files.length - 1, view.index + delta))
      if (next === view.index) return // already at the edge; not a navigation
      setRawIndex(raw.files.indexOf(view.files[next]))
      setHasNavigated(true)
    },
    [raw, view]
  )

  const file = view?.files[view.index] ?? null

  /* ---------- file operations ---------- */

  // Renaming and deleting are the only things Prism does that change your files,
  // so both are confirmable and neither destroys anything: an overwritten or
  // deleted file goes to the Recycle Bin.
  const [refreshKey, setRefreshKey] = useState(0)
  const [ask, setAsk] = useState<Ask | null>(null)

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
      if (e.key === 'F11') {
        e.preventDefault()
        window.prism.setFullscreen(!fullscreen)
      } else if ((e.key === 'b' || e.key === 'B') && e.ctrlKey && !typing) {
        e.preventDefault()
        toggleSidebar()
      } else if (e.key === 'Escape') {
        // Settings owns Escape while it's open (its own handler closes it).
        // Without this, the window would shut instead: both listeners are on
        // window in the capture phase, and this one was registered first.
        if (settingsOpen) return
        if (fullscreen) window.prism.setFullscreen(false)
        else window.prism.close()
      } else if (e.key === 'PageDown') go(1)
      else if (e.key === 'PageUp') go(-1)
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !typing) {
        const playerOwnsArrows = !!file && PLAYABLE.has(file.kind) && !hasNavigated
        if (!playerOwnsArrows) {
          e.preventDefault() // player checks defaultPrevented and yields
          go(e.key === 'ArrowRight' ? 1 : -1)
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [file, fullscreen, go, hasNavigated, settingsOpen, toggleSidebar])

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
    const over = (e: DragEvent): void => { e.preventDefault(); setDragging(true) }
    const leave = (): void => setDragging(false)
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(false)
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
  }, [open])

  const many = (view?.files.length ?? 0) > 1
  const pos = many ? `${view!.index + 1} / ${view!.files.length}` : ''

  // Fullscreen is for watching, not browsing: no tree, no arrows, no chrome.
  // Outside fullscreen the panel stays mounted even when closed, so it can slide.
  return (
    <div className="flex h-full flex-col bg-[var(--p-bg)] text-[var(--p-text)] [font-size:var(--p-size)]">
      {!fullscreen && (
        <TopBar
          file={file}
          pos={pos}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((v) => !v)}
          sidebar={sidebar}
          onToggleSidebar={toggleSidebar}
        />
      )}
      {/* Settings covers this area. Hiding it (rather than leaving it painted
          underneath) is what lets a translucent style show its material through
          the settings page; `invisible` keeps a playing video alive. */}
      <div className={`flex min-h-0 flex-1 ${settingsOpen ? 'invisible' : ''}`}>
        {raw && !fullscreen && (
          <Sidebar
            open={sidebar}
            root={raw.root}
            currentPath={file?.path ?? null}
            refreshKey={refreshKey}
            onOpenFile={openFromTree}
            onRename={(p, name) => void runRename(p, name, 'ask')}
            onDelete={(path, name, isFolder) => setAsk({ kind: 'delete', path, name, isFolder })}
          />
        )}
        <div
          className={`group relative flex min-w-0 flex-1 items-center justify-center overflow-hidden ${
            dragging ? 'ring-2 ring-inset ring-[var(--p-accent)]' : ''
          }`}
        >
          {file ? <Viewer key={file.path} file={file} onToggleFullscreen={toggleFullscreen} fullscreen={fullscreen} transportStyle={transportStyle} /> : <EmptyState onOpen={browse} />}
          {/* Paging still works in fullscreen via PageUp/PageDown (and ←/→ for images). */}
          {file && many && !fullscreen && (
            <>
              <NavArrow dir="l" onClick={() => go(-1)} />
              <NavArrow dir="r" onClick={() => go(1)} />
            </>
          )}
        </div>
      </div>
      <Settings
        open={settingsOpen}
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

      {ask?.kind === 'failed' && (
        <Dialog
          title="That didn't work"
          body={ask.message}
          onCancel={() => setAsk(null)}
          choices={[{ label: 'OK', primary: true, onPick: () => setAsk(null) }]}
        />
      )}
    </div>
  )
}
