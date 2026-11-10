import type { JSX, ReactNode } from 'react'
import { Modal } from '../components/Modal'
import { DIALOG_BOX, DIALOG_TITLE, dialogButton } from '../components/dialogLook'
import type { DriveBar } from './deleteCopy'

/**
 * THE ONE DELETE QUESTION (#500, #504; owner, 2026-11-10: "minimal text").
 * Delete, Delete many, Delete permanently, Empty Recycle Bin and a zip's
 * Delete all draw through this, so they look the same apart from their words:
 * an icon (a bin for a delete, a warning for what cannot come back), a title,
 * one quiet line, and the buttons on the right. Only Empty has bars.
 *
 * ONE RULE FOR THE BUTTONS. The red solid button is the one that deletes.
 * `outline` is the red outline of the middle "Delete permanently". `focus` is
 * the default (Enter): Delete on a question whose answer can be undone,
 * Cancel on every question that cannot. The default is shown by the focus,
 * never a different colour, so the danger looks the same everywhere.
 * Documented in docs/dialogs.md.
 */

export interface DeleteChoice {
  label: string
  onPick: () => void
  tone: 'plain' | 'outline' | 'danger'
  /** Gets the focus: the button Enter presses. */
  focus?: boolean
}

const ICONS = {
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </>
  ),
  warn: (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  )
}

/** Red that follows the theme: the text colour mixed in, so it reads on a
 *  light panel (darker) as well as a dark one (lighter). */
const OUTLINE =
  'border border-[color:color-mix(in_srgb,#b4353f_60%,transparent)] bg-transparent text-[color-mix(in_srgb,#b4353f_62%,var(--p-text))] hover:bg-[color-mix(in_srgb,#b4353f_14%,transparent)] focus-visible:bg-[color-mix(in_srgb,#b4353f_14%,transparent)]'

function buttonClass(tone: DeleteChoice['tone']): string {
  if (tone === 'outline')
    return `rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-none ${OUTLINE}`
  return dialogButton({ danger: tone === 'danger' })
}

const pct = (share: number): string => `${Math.round(Math.min(Math.max(share, 0), 1) * 1000) / 10}%`

function Bar({ bar }: { bar: DriveBar }): JSX.Element {
  const known = bar.stays !== undefined && bar.freed !== undefined
  return (
    <div data-drive-bar data-drive={bar.drive}>
      <div className="mb-1 text-[12px] text-[var(--p-dim)]">{bar.drive}</div>
      {known && (
        <div
          role="img"
          aria-label={`${bar.drive} ${bar.freeText}, ${bar.freedText} when emptied`}
          className="flex h-2 overflow-hidden rounded bg-[color-mix(in_srgb,var(--p-text)_12%,transparent)]"
        >
          <span
            data-bar-stays
            style={{ width: pct(bar.stays!) }}
            className="bg-[color-mix(in_srgb,var(--p-text)_38%,transparent)]"
          />
          <span data-bar-freed style={{ width: pct(bar.freed!) }} className="bg-[var(--p-accent)]" />
        </div>
      )}
      <div className="mt-1.5 flex justify-between text-[12px] text-[var(--p-text-soft)]">
        <span data-bar-free>{bar.freeText ?? ''}</span>
        <span data-bar-freed-text className="text-[var(--p-text)]">
          {bar.freedText}
        </span>
      </div>
    </div>
  )
}

export function DeleteQuestion({
  icon,
  title,
  line,
  bars,
  choices,
  onCancel
}: {
  icon: 'trash' | 'warn'
  title: string
  /** The one quiet line: the size, or the names and the size. */
  line?: ReactNode
  /** Empty Recycle Bin only: one bar per drive. */
  bars?: DriveBar[]
  choices: DeleteChoice[]
  onCancel: () => void
}): JSX.Element {
  return (
    <Modal
      label={title}
      focusKey={title}
      onCancel={onCancel}
      className={DIALOG_BOX}
      attrs={{ 'data-delete-question': icon }}
    >
      <div className="flex gap-3">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          data-delete-icon={icon}
          className="mt-px h-5 w-5 shrink-0 fill-none stroke-[var(--p-dim)] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.7]"
        >
          {ICONS[icon]}
        </svg>
        <div className="min-w-0 flex-1">
          <h2 className={`${DIALOG_TITLE} break-words`}>{title}</h2>
          {line !== undefined && (
            <div data-delete-line className="mt-1 flex min-w-0 text-[12.5px] leading-relaxed text-[var(--p-dim)]">
              {line}
            </div>
          )}
        </div>
      </div>
      {bars && bars.length > 0 && (
        <div className="mt-3.5 space-y-3 pl-8" data-drive-bars>
          {bars.map((b) => (
            <Bar key={b.drive} bar={b} />
          ))}
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        {choices.map((c) => (
          <button
            key={c.label}
            data-primary={c.focus ? 'true' : undefined}
            data-tone={c.tone}
            onClick={c.onPick}
            className={buttonClass(c.tone)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </Modal>
  )
}
