import type { JSX, ReactNode } from 'react'
import { DIALOG_BODY, DIALOG_BOX, DIALOG_TITLE, dialogButton } from './dialogLook'
import { Modal } from './Modal'

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
  onCancel,
  wide = false
}: {
  title: string
  body?: ReactNode
  choices: Choice[]
  onCancel: () => void
  /** A body that is a tool, not a line (the folder icon picker). */
  wide?: boolean
}): JSX.Element {
  return (
    <Modal
      label={title}
      focusKey={title}
      onCancel={onCancel}
      className={wide ? DIALOG_BOX.replace('max-w-[420px]', 'max-w-[520px]') : DIALOG_BOX}
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
    </Modal>
  )
}
