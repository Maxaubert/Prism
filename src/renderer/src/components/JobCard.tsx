import type { JSX, Ref } from 'react'
import { dialogButton } from './dialogLook'
import { ProgressBar } from './ProgressBar'
import './jobCard.css'

/**
 * THE PROGRESS CARD (#501 and the progress half of #504; owner, 2026-11-10:
 * mockup B "cut down to minimal text"). What a long file job says, and all it
 * says: the title ("Copying 12 items", or the one name), the bar, the file
 * being worked on with a small count beside it ("3 of 12"), and Cancel. No
 * big percentage, no bytes, no time left (only a job that already reports
 * those cheaply could, and none does).
 *
 * It is the CONTENT of a surface, not a surface: the card over a tab's list
 * (`BusyBar`) and the extract window (`ExtractWindow`) each give it a box, so
 * the placement differs and the card does not. Every height is fixed, so
 * nothing moves as the count gains a digit or the file line ticks.
 */
export interface JobAction {
  label: string
  onPress: () => void
  disabled?: boolean
  /** Extra attributes for the button (a scenario's hook). */
  attrs?: Record<string, string | undefined>
  /** The accent button: Close on a failure. */
  primary?: boolean
}

export function JobCard({
  title,
  pct,
  file,
  fileRef,
  count,
  action,
  onCancel,
  cancelDisabled,
  cancelAttrs,
  stopped,
  label
}: {
  title: string
  /** 0-100, or null while the job has not said (the bar slides). */
  pct: number | null
  /** The file being worked on, or, stopped, the reason. */
  file?: string
  /** A node the caller writes the file line into (a fitted path), instead of `file`. */
  fileRef?: Ref<HTMLDivElement>
  /** "3 of 12": small, at the line's right. */
  count?: string
  /** The one button when it is not Cancel (Close, after a failure). */
  action?: JobAction
  onCancel?: () => void
  cancelDisabled?: boolean
  cancelAttrs?: Record<string, string | undefined>
  /** A failed job: the bar is hatched and the line is the reason. */
  stopped?: boolean
  label?: string
}): JSX.Element {
  return (
    <div className="job-card" data-job-card data-stopped={stopped ? '' : undefined}>
      <div className="job-card-title" data-job-title title={title}>
        {title}
      </div>
      <ProgressBar pct={pct} stopped={stopped} label={label ?? title} />
      <div className="job-card-line">
        {fileRef ? (
          <div
            ref={fileRef}
            className="job-card-file"
            data-job-file={stopped ? undefined : ''}
            data-job-error={stopped ? '' : undefined}
          />
        ) : (
          <div
            className="job-card-file"
            data-job-file={stopped ? undefined : ''}
            data-job-error={stopped ? '' : undefined}
            title={file || undefined}
          >
            {file}
          </div>
        )}
        {count ? (
          <span className="job-card-count" data-job-count>
            {count}
          </span>
        ) : null}
      </div>
      <div className="job-card-actions">
        {action ? (
          <button
            key={action.label}
            type="button"
            disabled={action.disabled}
            onClick={action.onPress}
            className={
              action.primary
                ? dialogButton({ primary: true }).replace(
                    'bg-[var(--p-accent)]',
                    'bg-[var(--p-sel-bg)]'
                  )
                : dialogButton({})
            }
            {...action.attrs}
          >
            {action.label}
          </button>
        ) : (
          <button
            key="cancel"
            type="button"
            disabled={cancelDisabled}
            onClick={onCancel}
            className={`job-card-cancel ${dialogButton({})}`}
            {...cancelAttrs}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
