import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'

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
  /** On a childless row, the action. On a row WITH children it makes the
   *  parent itself clickable too (e.g. "last used" defaults). */
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
      {/* A row can carry BOTH now (2026-08-27): the video menu's Speed row
          says what the speed currently is and still opens a flyout. */}
      <span className="flex shrink-0 items-center gap-2">
        {it.hint && (
          <span className="text-[10.5px] tracking-wide text-[var(--p-dim2)]">{it.hint}</span>
        )}
        {it.children && (
          <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70" aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
        )}
      </span>
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
  const [sub, setSub] = useState<{ index: number; anchorY: number; x: number; y: number } | null>(null)
  // Leaving a submenu parent doesn't close the flyout immediately: the natural
  // diagonal path into the flyout crosses the rows below, and closing on first
  // touch makes the menu read as flickering shut at random. Native menus give
  // a grace period; so does this one.
  const closeTimer = useRef<number | null>(null)
  const cancelClose = useCallback((): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])
  useEffect(() => cancelClose, [cancelClose])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8)
    })
  }, [x, y])

  const subItems = sub ? items[sub.index]?.children : null

  // The flyout hangs off its row, flipped to the left when the right edge
  // would push it off screen, and never below the bottom. Re-clamped from the
  // row's anchor whenever its CONTENT changes too: the app list lands async,
  // and a list that grew after the first clamp would run off the screen.
  //
  // Alignment is MEASURED, not assumed: render wherever, read where the first
  // row actually landed, and shift by the exact delta so its top edge meets
  // the parent row's visible surface (sub.anchorY). No border/padding
  // arithmetic to drift out of date, and fractional DPI scaling cancels
  // because both sides of the delta come from the same rendered layout.
  useLayoutEffect(() => {
    const el = fly.current
    const menu = box.current
    if (!el || !menu || !sub) return
    const r = el.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    // The flyout is a LAYER, not an extension: like every native submenu
    // (Windows 11, macOS), it overlaps the parent by a few pixels and casts
    // its shadow onto it. Butting the panels edge-to-edge read as one panel
    // with a seam down it; the overlap is what makes it read as a card above.
    let fx = menuRect.right - 6
    if (fx + r.width > window.innerWidth - 8) fx = menuRect.left - r.width + 6
    const firstTop = el.querySelector('[role="menuitem"]')?.getBoundingClientRect().top ?? r.top
    let fy = sub.y + (sub.anchorY - firstTop)
    fy = Math.max(8, Math.min(fy, window.innerHeight - r.height - 8))
    if (Math.abs(fx - sub.x) > 0.01 || Math.abs(fy - sub.y) > 0.01) setSub({ ...sub, x: fx, y: fy })
  }, [sub, subItems?.length])

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
    if (it.disabled) return
    // A parent that brings its own onPick is clickable (the flyout stays the
    // hover); one without is flyout-only, like "Open in".
    if (it.children && !it.onPick) return
    it.onPick?.()
    onClose()
  }

  const hover = (index: number, it: MenuItem, el: HTMLElement): void => {
    if (!it.children) {
      // Grace period, then close - unless the pointer reached the flyout (or
      // came back to the parent), which cancels the timer.
      if (sub && closeTimer.current === null) {
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = null
          setSub(null)
        }, 300)
      }
      return
    }
    cancelClose()
    if (sub?.index === index) return
    const r = el.getBoundingClientRect()
    // The anchor is the parent row's VISIBLE surface: its rect top plus its
    // own divider border, when it has one. The layout effect above then moves
    // the flyout until its first row's top measures exactly here.
    const anchorY = r.top + parseFloat(getComputedStyle(el).borderTopWidth || '0')
    setSub({ index, anchorY, x: window.innerWidth, y: anchorY - 1 }) // corrected after measure
  }

  return (
    // data-owns-escape: the app's own (earlier, capture-phase) Escape handler
    // yields to any element carrying it, so closing this menu can't close the
    // window underneath.
    // no-drag over the WHOLE window while the menu is up: the title bar and
    // the tab strip are window-drag regions, and Chromium hands those clicks
    // to the OS instead of the page - so a press there never reached the
    // dismiss listener and the menu just sat there. Carving the region out
    // for the life of the menu makes every click dismiss it, wherever it
    // lands. (Dragging the window by its bar can wait until the menu is shut.)
    <div data-owns-escape className="no-drag fixed inset-0 z-40 pointer-events-none">
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
          // Ambient shadow on top of the panel's own: the overlapped strip of
          // the parent visibly sits UNDER this card, whichever side it opens.
          style={{ left: sub.x, top: sub.y, boxShadow: '0 10px 28px rgba(0,0,0,.5), 0 0 14px rgba(0,0,0,.4)' }}
          onPointerEnter={cancelClose}
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
