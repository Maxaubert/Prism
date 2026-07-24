import { useCallback, useEffect, useState, type JSX } from 'react'
import type { OpenPayload, ViewerFile } from '@shared/types'
import { VideoView } from './components/VideoView'

// Phase 0/1 shell: a dark frameless window that opens a file (launch arg, drag,
// or dialog), routes by kind to a viewer, and pages through the folder. The video
// player is the first "perfect" viewer; image/audio/pdf/text are still stubs and
// get their own phase. All viewers eventually come from prism-core.

const PLAYABLE = new Set(['video', 'audio'])

function TopBar({ file, pos }: { file: ViewerFile | null; pos: string }): JSX.Element {
  const w = window.prism
  return (
    <div className="drag flex h-9 shrink-0 items-center gap-3 border-b border-white/[.06] bg-[#16181f] px-3 text-[13px]">
      <span className="font-semibold text-[#d6a1f0]">Prism</span>
      <span className="min-w-0 flex-1 truncate text-[var(--color-dim)]">{file ? file.name : ''}</span>
      {pos && <span className="text-[var(--color-dim)]">{pos}</span>}
      <div className="no-drag flex items-center gap-1">
        <button className="grid h-7 w-8 place-items-center rounded text-[var(--color-dim)] hover:bg-white/10" onClick={() => w.minimize()}>–</button>
        <button className="grid h-7 w-8 place-items-center rounded text-[var(--color-dim)] hover:bg-white/10" onClick={() => w.toggleMaximize()}>▢</button>
        <button className="grid h-7 w-8 place-items-center rounded text-[var(--color-dim)] hover:bg-red-500/80 hover:text-white" onClick={() => w.close()}>✕</button>
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
    <pre className="h-full w-full overflow-auto bg-[#0d0f14] p-6 font-mono text-[13px] leading-relaxed text-[#d7dae1] select-text">
      {text}
    </pre>
  )
}

function Viewer({ file, onToggleFullscreen }: { file: ViewerFile; onToggleFullscreen: () => void }): JSX.Element {
  const url = window.prism.mediaUrl(file.path)
  switch (file.kind) {
    case 'video':
      return <VideoView url={url} onToggleFullscreen={onToggleFullscreen} />
    case 'image':
      return <img src={url} alt={file.name} className="max-h-full max-w-full object-contain" />
    case 'audio':
      return (
        <div className="flex flex-col items-center gap-6">
          <div className="grid h-40 w-40 place-items-center rounded-3xl bg-gradient-to-br from-[#6f5be6] to-[#ef9bb0] text-6xl">♪</div>
          <audio src={url} controls autoPlay />
        </div>
      )
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
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--color-accent)]/20 text-3xl text-[var(--color-accent-hi)]">◇</div>
      <div className="text-lg font-semibold">Open a file to view it</div>
      <div className="text-sm text-[var(--color-dim)]">Drop a file here, or</div>
      <button className="no-drag rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110" onClick={onOpen}>
        Browse…
      </button>
    </div>
  )
}

export default function App(): JSX.Element {
  const [payload, setPayload] = useState<OpenPayload | null>(null)
  const [index, setIndex] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const open = useCallback((p: OpenPayload | null) => {
    if (p && p.files.length) {
      setPayload(p)
      setIndex(Math.max(0, Math.min(p.files.length - 1, p.index)))
    }
  }, [])

  useEffect(() => window.prism.onOpenFile(open), [open])
  useEffect(() => window.prism.onFullscreen(setFullscreen), [])

  const browse = useCallback(() => void window.prism.openDialog().then(open), [open])
  const toggleFullscreen = useCallback(() => window.prism.setFullscreen(!fullscreen), [fullscreen])
  const go = useCallback(
    (delta: number) => {
      if (!payload) return
      setIndex((i) => Math.max(0, Math.min(payload.files.length - 1, i + delta)))
    },
    [payload]
  )

  const file = payload?.files[index] ?? null

  // App-level keys. Arrow keys navigate the folder EXCEPT for playable media,
  // where the player owns them for seeking.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (fullscreen) window.prism.setFullscreen(false)
        else window.prism.close()
      } else if (e.key === 'PageDown') go(1)
      else if (e.key === 'PageUp') go(-1)
      else if (!file || !PLAYABLE.has(file.kind)) {
        if (e.key === 'ArrowRight') go(1)
        else if (e.key === 'ArrowLeft') go(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [file, fullscreen, go])

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

  const many = (payload?.files.length ?? 0) > 1
  const pos = many ? `${index + 1} / ${payload!.files.length}` : ''

  return (
    <div className="flex h-full flex-col">
      {!fullscreen && <TopBar file={file} pos={pos} />}
      <div
        className={`group relative flex flex-1 items-center justify-center overflow-hidden ${
          dragging ? 'ring-2 ring-inset ring-[var(--color-accent)]' : ''
        }`}
      >
        {file ? <Viewer key={file.path} file={file} onToggleFullscreen={toggleFullscreen} /> : <EmptyState onOpen={browse} />}
        {file && many && (
          <>
            <NavArrow dir="l" onClick={() => go(-1)} />
            <NavArrow dir="r" onClick={() => go(1)} />
          </>
        )}
      </div>
    </div>
  )
}
