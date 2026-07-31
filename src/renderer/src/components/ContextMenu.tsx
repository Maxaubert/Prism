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
  items,
  onClose
}: {
  x: number
  y: number
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
        className="absolute min-w-[168px] rounded-lg border border-white/10 bg-[#1b1e26] p-1 shadow-[0_18px_50px_rgba(0,0,0,.6)]"
      >
        {items.map((it) => (
          <button
            key={it.label}
            role="menuitem"
            onClick={() => {
              it.onPick()
              onClose()
            }}
            className={`flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
              it.danger ? 'text-[#e78d95] hover:bg-[#b4353f]/25 hover:text-white' : 'text-[#d7dae1] hover:bg-white/[.08] hover:text-white'
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
