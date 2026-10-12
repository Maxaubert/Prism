import { useRef, useState, type JSX } from 'react'
import type { ExplorerSection, ExplorerWidthBounds } from '../../lib/useExplorerWidths'

export function ExplorerResize({
  section,
  bounds,
  onResize,
  onLive,
  edge
}: {
  section: ExplorerSection
  bounds: ExplorerWidthBounds
  onResize: (value: number | null) => void
  /** A drag's moves: paint the width without keeping it (`useExplorerWidths`
   *  `live`). The release keeps it through `onResize`. */
  onLive?: (value: number) => void
  /** The window edge the panel sits against (#304: Sidebar position moves
   *  the places to the right and the preview to the left). A drag or an
   *  arrow toward the middle widens it. */
  edge: 'left' | 'right'
}): JSX.Element {
  const drag = useRef<{ x: number; value: number; last: number | null } | null>(null)
  // One paint per frame however fast the pointer reports.
  const frame = useRef(0)
  const end = (keep: boolean): void => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    const last = drag.current?.last ?? null
    drag.current = null
    setDragging(false)
    if (!keep || last === null) return
    // Painted too: a drag back to where it began changes no state, so React
    // would leave the last frame's width standing.
    onLive?.(last)
    onResize(last)
  }
  const [dragging, setDragging] = useState(false)
  const [pointerResize, setPointerResize] = useState(false)
  const direction = edge === 'right' ? -1 : 1
  // Only a panel off its usual edge says so: the left side's classes are
  // the ones the window always had.
  const turned =
    section === 'places' && edge === 'right'
      ? ' is-right'
      : section === 'preview' && edge === 'left'
        ? ' is-left'
        : ''
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={section === 'places' ? 'Resize Quick access' : 'Resize Explorer preview'}
      aria-valuemin={Math.round(bounds.min)}
      aria-valuemax={Math.round(bounds.max)}
      aria-valuenow={bounds.value}
      tabIndex={0}
      title="Drag to resize. Arrow keys adjust width. Double-click to reset."
      className={`explorer-resize explorer-resize-${section}${turned}`}
      data-dragging={dragging || undefined}
      data-pointer-resize={pointerResize || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        setPointerResize(true)
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, value: bounds.value, last: null }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const d = drag.current
        if (!d) return
        d.last = d.value + (event.clientX - d.x) * direction
        if (!onLive) {
          onResize(d.last)
          return
        }
        if (frame.current) return
        frame.current = requestAnimationFrame(() => {
          frame.current = 0
          if (drag.current?.last != null) onLive(drag.current.last)
        })
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
        end(true)
      }}
      // A capture lost mid-drag (the window lost focus) keeps where it got to.
      onLostPointerCapture={() => end(true)}
      onPointerCancel={() => end(true)}
      onDoubleClick={() => onResize(null)}
      onBlur={() => setPointerResize(false)}
      onKeyDown={(event) => {
        setPointerResize(false)
        const step = event.shiftKey ? 48 : 16
        if (event.key === 'ArrowLeft') onResize(bounds.value - step * direction)
        else if (event.key === 'ArrowRight') onResize(bounds.value + step * direction)
        else if (event.key === 'Home') onResize(bounds.min)
        else if (event.key === 'End') onResize(bounds.max)
        else return
        event.preventDefault()
        event.stopPropagation()
      }}
    />
  )
}
