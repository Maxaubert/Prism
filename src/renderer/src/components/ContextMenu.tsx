import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'

// The right-click menu for a tree row. Just the actions: you right-clicked the
// row, so you know what it applies to. Small, keyboard-dismissable, and clamped
// so it never opens off the edge of the window.

export interface MenuItem {
  label: string
  hint?: string
  danger?: boolean
  icon?: JSX.Element
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
    // Dismiss on any press outside the menu, but let that press through to
    // whatever it landed on: clicking a file while the menu is open should open
    // that file, not cost you a second click.
    const onDown = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      <div
        ref={box}
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        // Hairline: square, bordered, ruled between items. No inner padding, so
        // each row spans the full width and the rules read as structure.
        className="pointer-events-auto absolute min-w-[156px] overflow-hidden rounded-[2px] border border-white/[.12] bg-[var(--p-title)] shadow-[0_10px_28px_rgba(0,0,0,.5)]"
      >
        {items.map((it) => (
          <button
            key={it.label}
            role="menuitem"
            onClick={() => {
              it.onPick()
              onClose()
            }}
            className={`flex h-[28px] w-full items-center justify-between gap-8 border-t border-white/[.07] px-[11px] text-left text-[12px] transition-colors first:border-t-0 ${
              it.danger
                ? 'text-[#d97b84] hover:bg-[#b4353f]/20 hover:text-[#f0a4ab]'
                : 'text-[#c8ccd6] hover:bg-white/[.05] hover:text-white'
            }`}
          >
            <span className="flex items-center gap-2">
              {it.icon}
              {it.label}
            </span>
            {it.hint && <span className="text-[10.5px] tracking-wide text-[var(--color-dim2,#5f6474)]">{it.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
