import { useEffect, useRef, type JSX, type ReactNode } from 'react'
import { DIALOG_BOX, DIALOG_SCRIM } from './dialogLook'

/**
 * The modal shell that Dialog and PropertiesDialog wrap (structure cleanup,
 * 2026-10-12): the scrim, the box, Escape and a press outside to cancel, and
 * the focus on the box's `[data-primary="true"]` button. The extraction
 * window cannot be dismissed, so it is not one of these; it shares the look
 * through dialogLook.ts instead.
 */
export function Modal({
  label,
  focusKey,
  onCancel,
  className = DIALOG_BOX,
  attrs,
  children
}: {
  /** What a screen reader calls the dialog. */
  label: string
  /** The primary button takes the focus again whenever this changes: the
   *  question under a dialog that stays mounted, the file under Properties. */
  focusKey: string
  onCancel: () => void
  className?: string
  /** Extra data attributes for the box (e2e hooks). */
  attrs?: Record<`data-${string}`, string>
  children: ReactNode
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
  // without anyone reaching for the mouse. Again when `focusKey` changes under
  // a dialog that stays mounted: the buttons are keyed by label, so the
  // focused one is gone.
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('[data-primary="true"]')?.focus()
  }, [focusKey])

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
        aria-label={label}
        {...attrs}
        onMouseDown={(e) => e.stopPropagation()}
        className={className}
      >
        {children}
      </div>
    </div>
  )
}
