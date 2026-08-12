import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'

// The right-click menu for a tree row. Just the actions: you right-clicked the
// row, so you know what it applies to. Small, keyboard-dismissable, clamped so
// it never opens off the edge of the window, and able to carry one level of
// flyout (the "Open in" app list) - deeper nesting is a design smell, not a
// missing feature.

export interface MenuItem {
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  icon?: JSX.Element
  /** Ignored on rows that carry children; the flyout is the action. */
  onPick?: () => void
  /** One level of flyout, opened on hover. */
  children?: MenuItem[]
}

const PANEL =
  // Flat surface colour: --p-title is translucent on glass styles, and a menu
  // you can read the file names through is noise, not material.
  'overflow-hidden rounded-[2px] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] shadow-[0_10px_28px_rgba(0,0,0,.5)]'

function Row({
  it,
  expanded,
  onPick,
  onHover
}: {
  it: MenuItem
  /** True while this row's flyout is open. */
  expanded: boolean
  onPick: (it: MenuItem) => void
  onHover: (el: HTMLElement) => void
}): JSX.Element {
  return (
    <button
      role="menuitem"
      disabled={it.disabled}
      aria-haspopup={it.children ? 'menu' : undefined}
      aria-expanded={it.children ? expanded : undefined}
      onClick={() => onPick(it)}
      onPointerEnter={(e) => onHover(e.currentTarget)}
      className={`flex h-[28px] w-full items-center justify-between gap-8 border-t border-[color:var(--p-divider)] px-[11px] text-left text-[12px] transition-colors first:border-t-0 disabled:cursor-default disabled:opacity-50 ${
        it.danger
          ? 'text-[#d97b84] hover:bg-[#b4353f]/20 hover:text-[#f0a4ab]'
          : `text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] ${
              expanded ? 'bg-[var(--p-hover)] text-[var(--p-text)]' : ''
            }`
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {it.icon}
        <span className="truncate">{it.label}</span>
      </span>
      {it.children ? (
        <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70" aria-hidden>
          <path d="M9 6l6 6-6 6" />
        </svg>
      ) : (
        it.hint && <span className="text-[10.5px] tracking-wide text-[var(--p-dim2)]">{it.hint}</span>
      )}
    </button>
  )
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
  const fly = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8)
    })
  }, [x, y])

  // The flyout hangs off its row, flipped to the left when the right edge
  // would push it off screen, and never below the bottom.
  useLayoutEffect(() => {
    const el = fly.current
    const menu = box.current
    if (!el || !menu || !sub) return
    const w = el.getBoundingClientRect().width
    const h = el.getBoundingClientRect().height
    const menuRect = menu.getBoundingClientRect()
    let fx = menuRect.right - 2
    if (fx + w > window.innerWidth - 8) fx = menuRect.left - w + 2
    const fy = Math.min(sub.y, window.innerHeight - h - 8)
    if (fx !== sub.x || fy !== sub.y) setSub({ ...sub, x: fx, y: fy })
  }, [sub])

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
      const t = e.target as Node
      if (!box.current?.contains(t) && !fly.current?.contains(t)) onClose()
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

  const pick = (it: MenuItem): void => {
    if (it.children || it.disabled) return
    it.onPick?.()
    onClose()
  }

  const hover = (index: number, it: MenuItem, el: HTMLElement): void => {
    if (!it.children) {
      setSub(null)
      return
    }
    if (sub?.index === index) return
    const r = el.getBoundingClientRect()
    setSub({ index, x: window.innerWidth, y: r.top - 5 }) // clamped after measure
  }

  const subItems = sub ? items[sub.index]?.children : null

  return (
    // data-owns-escape: the app's own (earlier, capture-phase) Escape handler
    // yields to any element carrying it, so closing this menu can't close the
    // window underneath.
    <div data-owns-escape className="fixed inset-0 z-40 pointer-events-none">
      <div
        ref={box}
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        className={`pointer-events-auto absolute min-w-[156px] ${PANEL}`}
      >
        {items.map((it, i) => (
          <Row key={it.label} it={it} expanded={sub?.index === i} onPick={pick} onHover={(el) => hover(i, it, el)} />
        ))}
      </div>
      {subItems && sub && (
        <div
          ref={fly}
          role="menu"
          style={{ left: sub.x, top: sub.y }}
          className={`pointer-events-auto absolute min-w-[176px] max-w-[260px] ${PANEL}`}
        >
          {subItems.map((it) => (
            <Row key={it.label} it={it} expanded={false} onPick={pick} onHover={() => {}} />
          ))}
        </div>
      )}
    </div>
  )
}
