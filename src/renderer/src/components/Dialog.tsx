import { useEffect, useRef, type JSX, type ReactNode } from 'react'
import { DIALOG_BODY, DIALOG_BOX, DIALOG_SCRIM, DIALOG_TITLE, dialogButton } from './dialogLook'

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
    // data-owns-escape: the app's capture-phase Escape handler registered
    // first and would otherwise close the WINDOW while a dialog is up.
    <div data-owns-escape className={DIALOG_SCRIM} role="presentation" onMouseDown={onCancel}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={DIALOG_BOX}
      >
        <h2 className={DIALOG_TITLE}>{title}</h2>
        {body && <div className={DIALOG_BODY}>{body}</div>}
        <div className="mt-5 flex justify-end gap-2">
          {choices.map((c) => (
            <button
              key={c.label}
              data-primary={c.primary ? 'true' : undefined}
              onClick={c.onPick}
              className={dialogButton(c)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
