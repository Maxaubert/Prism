import { useCallback, useEffect, useState, type JSX } from 'react'
import type { OpenPayload, ViewerFile } from '@shared/types'

// Phase 0 shell: a dark frameless window that opens a file (launch arg, drag, or
// dialog), routes by kind to a PLACEHOLDER viewer, and arrows through the folder.
// The placeholder viewers are intentionally minimal; Phase 1 replaces <Viewer>
// with the polished components from prism-core.

function TopBar({ file, pos }: { file: ViewerFile | null; pos: string }): JSX.Element {
  const w = window.prism
  return (
    <div className="drag flex h-9 shrink-0 items-center gap-3 border-b border-white/[.06] bg-[#16181f] px-3 text-[13px]">
      <span className="font-semibold text-[#d6a1f0]">Prism</span>
      <span className="min-w-0 flex-1 truncate text-[var(--color-dim)]">{file ? file.name : ''}</span>
      {file && <span className="text-[var(--color-dim)]">{pos}</span>}
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

/** Placeholder viewer, replaced by prism-core in Phase 1. */
function Viewer({ file }: { file: ViewerFile }): JSX.Element {
  const url = window.prism.mediaUrl(file.path)
  switch (file.kind) {
    case 'image':
      return <img src={url} alt={file.name} className="max-h-full max-w-full object-contain" />
    case 'video':
      return <video src={url} controls autoPlay className="max-h-full max-w-full" />
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

function EmptyState({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--color-accent)]/20 text-3xl text-[var(--color-accent-hi)]">◇</div>
      <div className="text-lg font-semibold">Open a file to view it</div>
      <div className="text-sm text-[var(--color-dim)]">Drop a file here, or</div>
      <button
        className="no-drag rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        onClick={onOpen}
      >
        Browse…
      </button>
    </div>
  )
}

export default function App(): JSX.Element {
  const [payload, setPayload] = useState<OpenPayload | null>(null)
  const [index, setIndex] = useState(0)
  const [dragging, setDragging] = useState(false)

  const open = useCallback((p: OpenPayload | null) => {
    if (p && p.files.length) {
      setPayload(p)
      setIndex(Math.max(0, Math.min(p.files.length - 1, p.index)))
    }
  }, [])

  useEffect(() => window.prism.onOpenFile(open), [open])

  const browse = useCallback(() => void window.prism.openDialog().then(open), [open])

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!payload) return
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(payload.files.length - 1, i + 1))
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
      else if (e.key === 'Escape') window.prism.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [payload])

  // Drag-and-drop (path via webUtils, since Electron removed File.path).
  useEffect(() => {
    const over = (e: DragEvent): void => {
      e.preventDefault()
      setDragging(true)
    }
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

  const file = payload?.files[index] ?? null
  const pos = payload && payload.files.length > 1 ? `${index + 1} / ${payload.files.length}` : ''

  return (
    <div className="flex h-full flex-col">
      <TopBar file={file} pos={pos} />
      <div
        className={`relative flex flex-1 items-center justify-center overflow-hidden p-3 ${
          dragging ? 'ring-2 ring-inset ring-[var(--color-accent)]' : ''
        }`}
      >
        {file ? <Viewer key={file.path} file={file} /> : <EmptyState onOpen={browse} />}
      </div>
    </div>
  )
}
