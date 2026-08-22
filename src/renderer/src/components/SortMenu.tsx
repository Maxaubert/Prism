import { useEffect, useRef, useState, type JSX } from 'react'
import { SORT_FIELDS, setSortDir, setSortField, useSort } from '../lib/sortPrefs'

// The sidebar's handle on folder order, beside the filter. Playnite's shape:
// one Ascending/Descending pair at the top, a rule, then the fields - one
// direction toggle for the menu, not one per field. The button stays
// icon-coloured whatever is applied; the menu's check carries the state.

const MENU_W = 156

function Row({ label, active, onPick }: { label: string; active: boolean; onPick: () => void }): JSX.Element {
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      onClick={onPick}
      className={`flex h-[26px] w-full items-center justify-between px-[11px] text-left text-[12px] transition-colors hover:bg-[var(--p-hover)] ${
        active ? 'text-[var(--p-accent-hi)]' : 'text-[var(--p-text-soft)] hover:text-[var(--p-text)]'
      }`}
    >
      {label}
      {active && (
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4.5 12.5l5 5 10-11" />
        </svg>
      )}
    </button>
  )
}

export function SortMenu(): JSX.Element {
  const sort = useSort()
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)


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

  /** Run the choice, then shut the menu, whichever row it was. */
  const pick = (apply: () => void) => () => {
    apply()
    setOpen(null)
  }

  return (
    <div ref={box} className="no-drag relative">
      <button
        // Icon-coloured like its neighbours, whatever sort is applied: the
        // menu's check says what is set, the button need not shout it.
        className="grid h-6 w-7 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-white/10 hover:text-[var(--p-text)]"
        onClick={toggle}
        title={`Sort: ${SORT_FIELDS.find((s) => s.id === sort.field)?.name}, ${sort.dir === 'asc' ? 'ascending' : 'descending'}`}
        aria-label="Sort order"
        aria-haspopup="menu"
        aria-expanded={!!open}
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 4v14M7 18l-3-3.2M7 18l3-3.2M17 20V6M17 6l-3 3.2M17 6l3 3.2" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Sort order"
          data-owns-escape
          style={{ left: open.x, top: open.y, width: MENU_W }}
          className="fixed z-40 overflow-hidden rounded-[2px] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] py-0.5 font-normal normal-case tracking-normal shadow-[0_10px_28px_rgba(0,0,0,.5)]"
        >
          <Row label="Ascending" active={sort.dir === 'asc'} onPick={pick(() => setSortDir('asc'))} />
          <Row label="Descending" active={sort.dir === 'desc'} onPick={pick(() => setSortDir('desc'))} />
          <div className="my-0.5 h-px bg-[var(--p-divider)]" />
          {SORT_FIELDS.map((fieldOption) => (
            <Row
              key={fieldOption.id}
              label={fieldOption.name}
              active={sort.field === fieldOption.id}
              onPick={pick(() => setSortField(fieldOption.id))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
