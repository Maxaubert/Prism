import { lazy, Suspense, useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { clampTermSize, dockAxis, type DockEdge } from '../lib/termDock'
import { quotePaths } from '../lib/termPaste'

// The terminal's dock: size, drag handle, right-click dock menu, drop scoping.
// No xterm imports here - the heavy chunk stays behind the lazy boundary.
const TerminalPanel = lazy(() => import('./TerminalPanel'))

const EDGE_NAMES: Array<{ edge: DockEdge; label: string }> = [
  { edge: 'bottom', label: 'Dock bottom' },
  { edge: 'top', label: 'Dock top' },
  { edge: 'left', label: 'Dock left' },
  { edge: 'right', label: 'Dock right' }
]

export function TermDock({
  mode,
  onClose,
  edge,
  size,
  onResize,
  onDockPick,
  sessionId,
  root,
  shellId
}: {
  /** `full` takes the whole viewer area: no handle, no size, and the dock menu
   *  waits for split (where an edge means something). */
  mode: 'full' | 'split'
  /** The split's X: hide this pane, leaving the file the room. */
  onClose: () => void
  edge: DockEdge
  size: number
  onResize: (px: number) => void
  onDockPick: (edge: DockEdge) => void
  sessionId: string
  root: string
  shellId: string | undefined
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const vertical = dockAxis(edge) === 'y'

  // Drag the INNER edge (the side facing the viewer), Sidebar's pattern:
  // pointer capture on the handle, the axis follows the dock.
  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = panel.current
      if (!el) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const startPos = vertical ? e.clientY : e.clientX
      const startSize = size
      const total = vertical
        ? (el.parentElement?.clientHeight ?? 800)
        : (el.parentElement?.clientWidth ?? 1200)
      // Growing means dragging TOWARD the viewer, whichever side we sit on.
      const sign = edge === 'bottom' || edge === 'right' ? -1 : 1
      const move = (ev: PointerEvent): void => {
        const delta = (vertical ? ev.clientY : ev.clientX) - startPos
        onResize(clampTermSize(startSize + sign * delta, total))
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [edge, onResize, size, vertical]
  )

  useEffect(() => {
    if (!menu) return
    const shut = (): void => setMenu(null)
    window.addEventListener('pointerdown', shut)
    window.addEventListener('blur', shut)
    return () => {
      window.removeEventListener('pointerdown', shut)
      window.removeEventListener('blur', shut)
    }
  }, [menu])

  // A file dropped ON the terminal types its quoted path - the other way
  // images (and any file) get into an AI prompt. stopPropagation keeps App's
  // window-level drop from opening it in the viewer instead.
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const paths = [...e.dataTransfer.files]
        .map((f) => window.prism.getDroppedPath(f))
        .filter(Boolean)
      if (paths.length) window.prism.termInput(sessionId, quotePaths(paths))
    },
    [sessionId]
  )

  // The handle paints the panel's own dark, not transparency: an unpainted
  // strip over the wrapper read as a bright line across the dock.
  const handleBase = 'shrink-0 no-drag z-10 bg-[var(--p-bg)] transition-colors'
  const handleAxis = vertical
    ? `${handleBase} h-1 w-full cursor-ns-resize`
    : `${handleBase} w-1 h-full cursor-ew-resize`
  // The handle hugs the inner edge; flex order puts it before the terminal for
  // bottom/right (panel is last child) and after it for top/left (reversed).
  const inner = edge === 'bottom' || edge === 'right'
  const full = mode === 'full'

  return (
    <div
      ref={panel}
      data-term-panel
      className={`group relative flex bg-[var(--p-bg)] ${vertical ? 'flex-col' : 'flex-row'} ${
        full
          ? 'min-h-0 min-w-0 flex-1'
          : `shrink-0 border-[var(--p-divider)] ${
              { bottom: 'border-t', top: 'border-b', left: 'border-r', right: 'border-l' }[edge]
            }`
      }`}
      style={full ? undefined : vertical ? { height: size } : { width: size }}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!full) setMenu({ x: e.clientX, y: e.clientY })
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={onDrop}
    >
      {!full && inner && <div className={`${handleAxis} hover:bg-[var(--p-accent)]/40`} onPointerDown={startDrag} />}
      {!full && (
        <button
          className="no-drag absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded bg-black/30 text-[var(--p-icon)] opacity-0 transition-opacity hover:bg-black/50 hover:text-[var(--p-text)] focus-visible:opacity-100 group-hover:opacity-100"
          onClick={onClose}
          title="Remove from split view"
          aria-label="Remove the terminal from the split"
        >
          <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
      <div className="min-h-0 min-w-0 flex-1">
        <Suspense fallback={<div className="grid h-full place-items-center text-sm text-[var(--p-dim)]">Starting shell…</div>}>
          <TerminalPanel sessionId={sessionId} root={root} shellId={shellId} />
        </Suspense>
      </div>
      {!full && !inner && <div className={`${handleAxis} hover:bg-[var(--p-accent)]/40`} onPointerDown={startDrag} />}

      {menu && (
        <div
          role="menu"
          aria-label="Dock the terminal"
          className="fixed z-50 overflow-hidden rounded-[2px] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] py-0.5 shadow-[0_10px_28px_rgba(0,0,0,.5)]"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {EDGE_NAMES.map((it) => (
            <button
              key={it.edge}
              role="menuitemradio"
              aria-checked={it.edge === edge}
              className={`block w-full px-3 py-1 text-left text-[12px] hover:bg-white/10 ${
                it.edge === edge ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-text)]'
              }`}
              onClick={() => {
                setMenu(null)
                onDockPick(it.edge)
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
