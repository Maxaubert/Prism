import { useEffect, useRef, useState, type JSX } from 'react'
import { NAV_SCOPES, setNavScope, useNavScope } from '../lib/navScope'

// The sidebar's handle on the navigation scope: the same three options as
// Settings > General, backed by the same store, so the two stay in sync. The
// funnel is filled while a filter narrows the list ('group' or 'type') and
// outlined when everything is in one list ('all').

export function FilterMenu(): JSX.Element {
  const scope = useNavScope()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const filtering = scope !== 'all'
  const current = NAV_SCOPES.find((s) => s.id === scope)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    // Dismiss on any press outside, letting that press through to what it hit
    // (same behaviour as the tree's context menu).
    const onDown = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onBlur = (): void => setOpen(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  return (
    <div ref={box} className="no-drag relative">
      <button
        className={`grid h-6 w-7 place-items-center rounded transition-colors hover:bg-white/10 ${
          filtering ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-icon)] hover:text-[var(--p-text)]'
        }`}
        onClick={() => setOpen((v) => !v)}
        title={`Navigation filter: ${current?.name ?? ''}`}
        aria-label="Navigation filter"
        aria-haspopup="menu"
        aria-expanded={open}
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
          // normal-case etc: the sidebar header this sits in is an uppercase,
          // letter-spaced label, and the menu must not inherit that voice.
          className="absolute right-0 top-full z-40 mt-1 w-[218px] overflow-hidden rounded-[2px] border border-[color:var(--p-divider)] bg-[var(--p-title)] font-normal normal-case tracking-normal shadow-[0_10px_28px_rgba(0,0,0,.5)]"
        >
          {NAV_SCOPES.map((s) => (
            <button
              key={s.id}
              role="menuitemradio"
              aria-checked={s.id === scope}
              onClick={() => {
                setNavScope(s.id)
                setOpen(false)
              }}
              className={`block w-full border-t border-[color:var(--p-divider)] px-[11px] py-[6px] text-left transition-colors first:border-t-0 hover:bg-[var(--p-hover)] ${
                s.id === scope ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-text-soft)] hover:text-[var(--p-text)]'
              }`}
            >
              <span className="flex items-center justify-between text-[12px]">
                {s.name}
                {s.id === scope && (
                  <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4.5 12.5l5 5 10-11" />
                  </svg>
                )}
              </span>
              <span className="mt-0.5 block text-[10.5px] normal-case tracking-normal text-[var(--p-dim2)]">
                {s.hint}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
