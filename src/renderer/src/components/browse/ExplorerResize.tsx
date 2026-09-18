import { useRef, useState, type JSX } from 'react'
import type { ExplorerSection, ExplorerWidthBounds } from '../../lib/useExplorerWidths'

export function ExplorerResize({
  section,
  bounds,
  onResize,
  right = false
}: {
  section: ExplorerSection
  bounds: ExplorerWidthBounds
  onResize: (value: number | null) => void
  right?: boolean
}): JSX.Element {
  const drag = useRef<{ x: number; value: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pointerResize, setPointerResize] = useState(false)
  const direction = section === 'preview' || right ? -1 : 1
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
      className={`explorer-resize explorer-resize-${section}${right ? ' is-right' : ''}`}
      data-dragging={dragging || undefined}
      data-pointer-resize={pointerResize || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        setPointerResize(true)
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, value: bounds.value }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (drag.current)
          onResize(drag.current.value + (event.clientX - drag.current.x) * direction)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
        drag.current = null
        setDragging(false)
      }}
      onLostPointerCapture={() => {
        drag.current = null
        setDragging(false)
      }}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
      }}
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
