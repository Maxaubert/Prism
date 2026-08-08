import { useEffect, useRef, useState, type JSX } from 'react'
import { NAV_SCOPES, setNavScope, useNavScope } from '../lib/navScope'

// The sidebar's handle on the navigation scope: the same three options as
// Settings > General, backed by the same store, so the two stay in sync. The
// funnel is filled while a filter narrows the list ('group' or 'type') and
// outlined when everything is in one list ('all').

const MENU_W = 156

export function FilterMenu(): JSX.Element {
  const scope = useNavScope()
  // Where the popover goes, in window coordinates: the sidebar clips its own
  // overflow (it has to, for the width-collapse slide), so the menu positions
  // itself `fixed` from the button instead of absolutely inside the panel.
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const filtering = scope !== 'all'
  const current = NAV_SCOPES.find((s) => s.id === scope)

  const toggle = (e: { currentTarget: HTMLElement }): void => {
    if (open) {
      setOpen(null)
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    setOpen({
      x: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
      y: r.bottom + 4
    })
  }

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    // Dismiss on any press outside, letting that press through to what it hit
    // (same behaviour as the tree's context menu). A resize moves the anchor
    // out from under the fixed menu, so it closes too.
    const onDown = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <div ref={box} className="no-drag relative">
      <button
        className={`grid h-6 w-7 place-items-center rounded transition-colors hover:bg-white/10 ${
          filtering ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-icon)] hover:text-[var(--p-text)]'
        }`}
        onClick={toggle}
        title={`Navigation filter: ${current?.name ?? ''}`}
        aria-label="Navigation filter"
        aria-haspopup="menu"
        aria-expanded={!!open}
      >
        <svg
          viewBox="0 0 24 24"
          width={13}
          height={13}
          fill={filtering ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 5h18l-7 8v5.5L10 21v-8L3 5z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Navigation filter"
          data-owns-escape
          style={{ left: open.x, top: open.y, width: MENU_W }}
          // normal-case etc: the sidebar header this sits in is an uppercase,
          // letter-spaced label, and the menu must not inherit that voice.
          // The flat surface colour, not the title bar's: on a glass style the
          // title carries the window alpha, and a see-through menu reads as a
          // rendering mistake over whatever it happens to cover.
          className="fixed z-40 overflow-hidden rounded-[2px] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] font-normal normal-case tracking-normal shadow-[0_10px_28px_rgba(0,0,0,.5)]"
        >
          {NAV_SCOPES.map((s) => (
            <button
              key={s.id}
              role="menuitemradio"
              aria-checked={s.id === scope}
              onClick={() => {
                setNavScope(s.id)
                setOpen(null)
              }}
              // The hint stays in the title: the row itself is just the name,
              // so the menu reads at a glance (and Settings keeps the long form).
              title={s.hint}
              className={`flex h-[28px] w-full items-center justify-between border-t border-[color:var(--p-divider)] px-[11px] text-left text-[12px] transition-colors first:border-t-0 hover:bg-[var(--p-hover)] ${
                s.id === scope ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-text-soft)] hover:text-[var(--p-text)]'
              }`}
            >
              {s.name}
              {s.id === scope && (
                <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4.5 12.5l5 5 10-11" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
