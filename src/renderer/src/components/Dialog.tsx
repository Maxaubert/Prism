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
  // THE LISTENER IS REGISTERED ONCE, and reads the latest onCancel from a ref
  // (2026-09-20, #168). Every caller passes an inline arrow, so keyed on
  // `onCancel` the effect tore the listener down and put a new one up on EVERY
  // render of the app. That has a hole in it, MEASURED in Prism Terminal's copy
  // of this component (its updateGuard e2e, about one run in five): when
  // another keydown listener on the window sets state during the same Escape,
  // React flushes this effect between the two listeners, the old listener is
  // removed before its turn, and one added during a dispatch is not called for
  // that event. Escape then did nothing, with the question on screen and
  // focused. Prism's App has more window-level key listeners than the terminal
  // does, so the same fix is carried over rather than waited for.
  const cancel = useRef(onCancel)
  useEffect(() => {
    cancel.current = onCancel
  })

  // Focus lands on the primary action, so Enter confirms and Escape backs out
  // without anyone reaching for the mouse. Again when the QUESTION changes
  // under a dialog that stays mounted: the buttons are keyed by label, so the
  // focused one is gone. (The re-running effect used to do this by accident.)
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('[data-primary="true"]')?.focus()
  }, [title])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        cancel.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

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
