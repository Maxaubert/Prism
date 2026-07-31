import { useEffect, useRef, type JSX, type ReactNode } from 'react'

// A small modal for the handful of questions Prism has to ask before touching a
// file. Deliberately plain: a title, a line of explanation, and the choices as
// buttons in the order you'd read them, with the safe one first.

export interface Choice {
  label: string
  onPick: () => void
  /** The one that acts. Gets the accent, and Enter picks it. */
  primary?: boolean
  /** Reads as a warning (overwriting, deleting). */
  danger?: boolean
}

export function Dialog({
  title,
  body,
  choices,
  onCancel
}: {
  title: string
  body?: ReactNode
  choices: Choice[]
  onCancel: () => void
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Focus lands on the primary action, so Enter confirms and Escape backs out
    // without anyone reaching for the mouse.
    box.current?.querySelector<HTMLButtonElement>('[data-primary="true"]')?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6" role="presentation" onMouseDown={onCancel}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-xl border border-white/10 bg-[#16181f] p-5 shadow-[0_24px_70px_rgba(0,0,0,.6)]"
      >
        <h2 className="text-[14.5px] font-semibold text-white">{title}</h2>
        {body && <div className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-dim)]">{body}</div>}
        <div className="mt-5 flex justify-end gap-2">
          {choices.map((c) => (
            <button
              key={c.label}
              data-primary={c.primary ? 'true' : undefined}
              onClick={c.onPick}
              className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-hi)] ${
                c.danger
                  ? 'bg-[#b4353f] text-white hover:brightness-110'
                  : c.primary
                    ? 'bg-[var(--color-accent)] text-white hover:brightness-110'
                    : 'border border-white/12 bg-white/[.04] text-[#d7dae1] hover:border-white/25 hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
