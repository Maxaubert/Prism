import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'

// The right-click menu for a tree row. Small, keyboard-dismissable, and clamped
// so it never opens off the edge of the window.

export interface MenuItem {
  label: string
  hint?: string
  danger?: boolean
  onPick: () => void
}

export function ContextMenu({
  x,
  y,
  label,
  items,
  onClose
}: {
  x: number
  y: number
  /** What the menu is acting on, so the choices have a subject. */
  label?: string
  items: MenuItem[]
  onClose: () => void
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8)
    })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div
        ref={box}
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute min-w-[172px] rounded border border-white/[.09] bg-[#15171d] py-1 shadow-[0_14px_40px_rgba(0,0,0,.55)]"
      >
        {label && (
          <div className="truncate border-b border-white/[.06] px-3 pb-1.5 pt-0.5 text-[11px] text-[var(--color-dim2,#6b7080)]">
            {label}
          </div>
        )}
        {items.map((it) => (
          <button
            key={it.label}
            role="menuitem"
            onClick={() => {
              it.onPick()
              onClose()
            }}
            className={`flex h-[26px] w-full items-center justify-between gap-6 px-3 text-left text-[12.5px] transition-colors ${
              it.danger ? 'text-[#e0868f] hover:bg-[#b4353f] hover:text-white' : 'text-[#d7dae1] hover:bg-[var(--color-accent)] hover:text-white'
            }`}
          >
            {it.label}
            {it.hint && <span className="text-[11px] text-[var(--color-dim2,#6b7080)]">{it.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
