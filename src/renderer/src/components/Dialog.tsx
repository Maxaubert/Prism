import type { JSX, ReactNode } from 'react'
import { DIALOG_BODY, DIALOG_TITLE, dialogBox, dialogButton } from 'prism-term-core/renderer/components/dialogLook'
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
      boxClassName={dialogBox({ width: wide ? 520 : 420 })}
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
