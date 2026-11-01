import type { JSX } from 'react'
import { chipSummary, useJobs } from '../lib/jobs'

/**
 * THE JOB CHIP (2026-09-03, owner): the one readout for every long job, an
 * overlay rather than a popup, so a paste or an extraction never stops you
 * doing something else. ONE ROW (owner, same day): the label on the left,
 * the bar CENTRED in the chip and taking the width between, the percentage
 * and the queue count on the right. It fills the sidebar's footer up to the
 * terminal button, and floats at the window's bottom-left when the panel is
 * shut - both read the same store, so they can never disagree. Nothing to
 * click: a failure speaks through its own dialog, and a job that finishes
 * simply leaves (after the store's minimum showing, so a quick paste is
 * still seen).
 *
 * SAVE COPIES AS (#474; owner, 2026-11-01: "one job with progress and
 * Cancel") added the two things a chip says beyond a bar: a small Cancel
 * (x) on the right while a job that can stop runs, the one part of the chip
 * that takes a click, and the job's DONE NOTE ("Saved 37 copies, 2 could not
 * be read"), the whole line with no bar, for a few seconds after.
 */
export function JobChip({ floating = false }: { floating?: boolean }): JSX.Element | null {
  const jobs = useJobs()
  const s = chipSummary(jobs)
  if (!s) return null
  const title = jobs
    .filter((j) => !j.holding)
    .map((j) => `${j.label}${j.pct === null ? '' : ` ${Math.round(j.pct)}%`}`)
    .join('\n')
  return (
    <div
      data-job-chip
      role="status"
      aria-live="polite"
      title={title}
      className={`pointer-events-none flex min-w-0 select-none items-center gap-2 rounded-full border border-[color:var(--p-line)] bg-[var(--p-side-flat)] px-2.5 text-[11px] text-[var(--p-text-soft)] shadow-[0_6px_18px_rgba(0,0,0,.35)] ${
        floating ? 'fixed bottom-3 left-3 z-40 h-7 w-[260px]' : 'h-[26px] flex-1'
      }`}
    >
      {/* leading-none on the text: an inherited line-height centred the LINE
          BOX and left the glyphs sitting low beside a 3px bar. */}
      <span
        data-job-label
        className={`${s.note ? 'min-w-0 flex-1' : 'max-w-[45%] shrink-0'} truncate leading-none`}
        {...(s.note ? { 'data-job-note': '' } : {})}
      >
        {s.label}
      </span>
      {!s.note && (
        <>
          {/* No width transition: the fill only ever grows from 0, and an
          indeterminate job pulses the TRACK with an empty fill rather than
          showing a block the first real number would then shrink from. */}
          <span
            className={`block h-[3px] min-w-[40px] flex-1 overflow-hidden rounded-full bg-[var(--p-track)] ${
              s.pct === null ? 'animate-pulse' : ''
            }`}
          >
            <span
              className="block h-full rounded-full bg-[var(--p-accent-solid)]"
              style={{ width: s.pct === null ? '0%' : `${Math.max(1, s.pct)}%` }}
            />
          </span>
          {s.pct !== null && (
            <span className="w-[30px] shrink-0 text-right font-mono text-[10px] leading-none text-[var(--p-dim)]">
              {Math.round(s.pct)}%
            </span>
          )}
        </>
      )}
      {s.cancel && (
        <button
          type="button"
          data-job-cancel
          aria-label="Cancel"
          title="Cancel"
          onClick={s.cancel}
          className="pointer-events-auto -mr-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[var(--p-dim)] hover:bg-[var(--p-track)] hover:text-[var(--p-text)]"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
            <path
              d="M1 1l6 6M7 1L1 7"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
      {s.more > 0 && (
        <span
          data-job-more
          className="shrink-0 rounded-full bg-[var(--p-accent)] px-1.5 text-[9.5px] font-semibold leading-[14px] text-[var(--p-on-accent)]"
        >
          +{s.more}
        </span>
      )}
    </div>
  )
}
