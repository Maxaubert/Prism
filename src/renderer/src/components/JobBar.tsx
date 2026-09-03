/**
 * The one progress readout every long job wears (2026-09-03, owner): a bar
 * AND the number, pulsing indeterminate until whoever is working reports.
 * Extraction, paste and any job dialog to come share this, because two
 * different progress looks for the same kind of wait read as two apps.
 */
import type { JSX } from 'react'

export function JobBar({ pct }: { pct: number | null }): JSX.Element {
  return (
    <span className="mt-2.5 block">
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--p-track)]">
        <span
          className={`block h-full rounded-full bg-[var(--p-accent)] ${
            pct === null ? 'w-1/3 animate-pulse' : 'transition-[width] duration-200'
          }`}
          style={pct === null ? undefined : { width: `${Math.max(2, pct)}%` }}
        />
      </span>
      {pct !== null && (
        <span className="mt-1 block text-right font-mono text-[11px] text-[var(--p-dim)]">
          {Math.round(pct)}%
        </span>
      )}
    </span>
  )
}
