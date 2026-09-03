import type { JSX } from 'react'
import { chipSummary, useJobs } from '../lib/jobs'

/**
 * THE JOB CHIP (2026-09-03, owner): the one readout for every long job, an
 * overlay rather than a popup, so a paste or an extraction never stops you
 * doing something else. Shaped like the picture's control pill: the label,
 * a thin bar under it, and a count when more jobs are queued behind the one
 * shown. It lives in the sidebar's footer beside the terminal button, and
 * floats at the window's bottom-left when the panel is shut - both read the
 * same store, so they can never disagree. Nothing to click: a failure speaks
 * through its own dialog, and a job that finishes simply leaves.
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
      className={`pointer-events-none flex min-w-0 select-none flex-col gap-[3px] rounded-full border border-[color:var(--p-line)] bg-[var(--p-side-flat)] px-2.5 py-[3px] text-[11px] text-[var(--p-text-soft)] shadow-[0_6px_18px_rgba(0,0,0,.35)] ${
        floating ? 'fixed bottom-3 left-3 z-40 w-[200px]' : 'w-[168px]'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate">{s.label}</span>
        {s.pct !== null && (
          <span className="shrink-0 font-mono text-[10px] text-[var(--p-dim)]">
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
      </span>
      <span className="block h-[3px] w-full overflow-hidden rounded-full bg-[var(--p-track)]">
        <span
          className={`block h-full rounded-full bg-[var(--p-accent)] ${
            s.pct === null ? 'w-1/3 animate-pulse' : 'transition-[width] duration-200'
          }`}
          style={s.pct === null ? undefined : { width: `${Math.max(2, s.pct)}%` }}
        />
      </span>
    </div>
  )
}
