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
 */
export function JobChip({ floating = false }: { floating?: boolean }): JSX.Element | null {
  const jobs = useJobs()
  const s = chipSummary(jobs)
  if (!s) return null
  const title = jobs.map((j) => `${j.label}${j.pct === null ? '' : ` ${Math.round(j.pct)}%`}`).join('\n')
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
      <span className="max-w-[45%] shrink-0 truncate">{s.label}</span>
      <span className="block h-[3px] min-w-[40px] flex-1 overflow-hidden rounded-full bg-[var(--p-track)]">
        <span
          className={`block h-full rounded-full bg-[var(--p-accent)] ${
            s.pct === null ? 'w-1/3 animate-pulse' : 'transition-[width] duration-200'
          }`}
          style={s.pct === null ? undefined : { width: `${Math.max(2, s.pct)}%` }}
        />
      </span>
      {s.pct !== null && (
        <span className="w-[30px] shrink-0 text-right font-mono text-[10px] text-[var(--p-dim)]">
          {Math.round(s.pct)}%
        </span>
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
