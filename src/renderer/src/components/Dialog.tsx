import type { JSX, ReactNode } from 'react'
import { DIALOG_BODY, DIALOG_TITLE, dialogBox, dialogButton, type DialogBoxOptions } from 'prism-term-core/renderer/components/dialogLook'
import { Modal } from 'prism-term-core/renderer/components/Modal'

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

/** THE ONE FOOTER (#520): the buttons on the right, 20px under the body. A
 *  Properties body that draws its own header passes `left` (Disk Cleanup) and
 *  the Close choice, and gets the same row a question has. */
export function DialogFooter({ choices, left }: { choices: Choice[]; left?: ReactNode }): JSX.Element {
  return (
    <div className="mt-5 flex items-center justify-end gap-2">
      {left && <div className="mr-auto flex gap-2">{left}</div>}
      {choices.map((c) => (
        <button
          key={c.label}
          type="button"
          data-primary={c.primary ? 'true' : undefined}
          onClick={c.onPick}
          className={dialogButton(c)}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

/** The only label of a dialog that has nothing to answer (owner, 2026-11-19). */
export const CLOSE_LABEL = 'Close'

/** The choices of a close-only dialog: one primary Close. */
export function closeOnly(onClose: () => void): Choice[] {
  return [{ label: CLOSE_LABEL, primary: true, onPick: onClose }]
}

export function Dialog({
  title,
  label,
  body,
  choices,
  left,
  onCancel,
  wide = false,
  box,
  boxClassName = '',
  boxAttrs,
  focusKey
}: {
  /** The heading. A body that draws its own header (Properties) leaves it out
   *  and names the window with `label`. */
  title?: string
  /** The accessible name when there is no `title`. */
  label?: string
  body?: ReactNode
  /** The footer's buttons. None, and the body brings its own footer. */
  choices?: Choice[]
  /** Buttons at the footer's left edge. */
  left?: ReactNode
  onCancel: () => void
  /** A body that is a tool, not a line (the folder icon picker). */
  wide?: boolean
  /** The box's width and padding, for a window wider than a question. */
  box?: DialogBoxOptions
  boxClassName?: string
  boxAttrs?: Record<string, string>
  focusKey?: string
}): JSX.Element {
  const name = title ?? label ?? ''
  return (
    <Modal
      label={name}
      focusKey={focusKey ?? name}
      onCancel={onCancel}
      boxAttrs={boxAttrs}
      boxClassName={`${dialogBox(box ?? { width: wide ? 520 : 420 })}${boxClassName ? ` ${boxClassName}` : ''}`}
    >
      {title && <h2 className={DIALOG_TITLE}>{title}</h2>}
      {body && (title ? <div className={DIALOG_BODY}>{body}</div> : body)}
      {choices && choices.length > 0 && <DialogFooter choices={choices} left={left} />}
    </Modal>
  )
}