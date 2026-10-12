import { DictationPill } from 'prism-term-core/renderer/components/DictationPill'
import { lazy, Suspense, useCallback, useRef, useState, type JSX } from 'react'
import { clampTermSize, dockAxis, type DockEdge } from '../lib/termDock'
import { dragPayload, droppedPaths, setDrag } from '../lib/dragDrop'
import { quotePaths } from 'prism-term-core/renderer/lib/termPaste'
import { shellOfShellId } from 'prism-term-core/shared/help/shells'
import { ContextMenu } from './ContextMenu'
import { pasteInto } from 'prism-term-core/renderer/lib/termBus'
import { copyText } from 'prism-term-core/renderer/lib/copyNotice'
import { terminalPanelMenu } from '../menus/terminalPanel'
import { Icon } from './icons/Icon'

// The terminal's dock: size, drag handle, right-click dock menu, drop scoping.
// No xterm imports here - the heavy chunk stays behind the lazy boundary.
const TerminalPanel = lazy(() => import('prism-term-core/renderer/components/TerminalPanel'))
// Same chunk as the panel, so the find bar's import of the session store
// costs the launch bundle nothing.
const TermFind = lazy(() => import('prism-term-core/renderer/components/TermFind'))

export function TermDock({
  mode,
  onClose,
  onKill,
  edge,
  size,
  onResize,
  onDockPick,
  sessionId,
  root,
  shellId,
  find,
  onFind
}: {
  /** `full` takes the whole viewer area: no handle, no size, and the dock menu
   *  waits for split (where an edge means something). */
  mode: 'full' | 'split'
  /** The split's X: hide this pane, leaving the file the room. */
  onClose: () => void
  /** Close the terminal for real: the shell dies, and the next open is a
   *  fresh one in the tab's current folder. */
  onKill: () => void
  edge: DockEdge
  size: number
  onResize: (px: number) => void
  onDockPick: (edge: DockEdge) => void
  sessionId: string
  root: string
  shellId: string | undefined
  /** Whether the scrollback find bar is up (Ctrl+Shift+F). */
  find: boolean
  onFind: (open: boolean) => void
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    /** What was selected when the menu opened, and the link under the point. */
    selection: string
    link: string | null
  } | null>(null)
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

  // A file dropped ON the terminal types its quoted path - the other way
  // images (and any file) get into an AI prompt. stopPropagation keeps App's
  // window-level drop from opening it in the viewer instead.
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Prism's own rows carry their paths in the drag payload, not as files:
      // dragging a picture out of the sidebar into an AI prompt has to work
      // as well as dragging it in from Explorer.
      const inside = dragPayload(e.dataTransfer)
      setDrag(null)
      const paths = inside?.kind === 'files' ? inside.paths : droppedPaths(e.dataTransfer)
      // Quoted for the SHELL it goes to (core-v0.15.1, the code review's #1):
      // single quotes for PowerShell and bash, which expand nothing, so a
      // file named `a $x.txt` arrives as its own name. Double quotes, the
      // old answer, let PowerShell expand `$x`. The dock's shell is the one
      // it was spawned with; unset is the default, PowerShell.
      if (paths.length) window.prism.termInput(sessionId, quotePaths(paths, shellOfShellId(shellId)))
    },
    [sessionId, shellId]
  )

  // The handle paints the panel's own dark, not transparency: an unpainted
  // strip over the wrapper read as a bright line across the dock.
  const handleBase = 'shrink-0 no-drag z-10 bg-[var(--p-bg)]'
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
      // NO GROUND HERE (2026-09-19, #154): the terminal PANEL paints --p-bg now
      // (prism-term-core, `paintsGround`), because xterm sizes itself in whole
      // rows and the strip under the last row was never its to paint. One
      // coat per pixel: a second, translucent one here is a visibly darker
      // terminal than the rest of an acrylic window.
      className={`group relative flex ${vertical ? 'flex-col' : 'flex-row'} ${
        full
          ? 'min-h-0 min-w-0 flex-1'
          : `shrink-0 border-[var(--p-divider)] ${
              { bottom: 'border-t', top: 'border-b', left: 'border-r', right: 'border-l' }[edge]
            }`
      }`}
      style={full ? undefined : vertical ? { height: size } : { width: size }}
      onContextMenu={(e) => {
        e.preventDefault()
        // Full view gets one too now (2026-08-30). It used to be split-only,
        // because the menu was nothing but the four dock edges - and an edge
        // means nothing when the terminal IS the view. Paste means something
        // in both, and that is what a right-click in a terminal is for.
        // What was clicked (#210): the core answers, read-only. The panel's
        // module is already loaded (it is on screen), so this resolves at once
        // and keeps the terminal out of the main chunk.
        const { clientX: x, clientY: y } = e
        void import('prism-term-core/renderer/components/TerminalPanel').then((m) =>
          setMenu({ x, y, ...m.termContextAt(sessionId, x, y) })
        )
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={onDrop}
    >
      {!full && inner && (
        <div className={handleAxis} onPointerDown={startDrag} />
      )}
      {!full && (
        <button
          className="no-drag absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded bg-black/30 text-[var(--p-icon)] opacity-0 transition-opacity hover:bg-black/50 hover:text-[var(--p-text)] focus-visible:opacity-100 group-hover:opacity-100"
          onClick={onClose}
          title="Remove from split view"
          aria-label="Remove the terminal from the split"
        >
          <Icon name="close" size={11} weight="2.2" join={false} />
        </button>
      )}
      <div className="relative min-h-0 min-w-0 flex-1">
        {/* What dictation is doing, over the shell it is dictating into (#162).
            The core's; absolutely placed, so the rows never move. */}
        <DictationPill sessionId={sessionId} />
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-sm text-[var(--p-dim)]">
              Starting shell…
            </div>
          }
        >
          <TerminalPanel sessionId={sessionId} root={root} shellId={shellId} />
        </Suspense>
      </div>
      {find && (
        <Suspense fallback={null}>
          <TermFind sessionId={sessionId} onClose={() => onFind(false)} />
        </Suspense>
      )}
      {!full && !inner && (
        <div className={handleAxis} onPointerDown={startDrag} />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={terminalPanelMenu({
            full,
            edge,
            link: menu.link,
            selection: menu.selection,
            onCopy: copyText,
            onPaste: () => pasteInto(sessionId),
            onFind,
            onDockPick,
            onRemoveFromSplit: onClose,
            onKill
          })}
        />
      )}
    </div>
  )
}
