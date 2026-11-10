import type { CSSProperties, JSX } from 'react'
import './jobCard.css'

/**
 * THE ONE BAR (#501; owner, 2026-11-10: extract and paste "should share
 * one"). Every progress bar in Prism is this element: the card over a tab,
 * the extract window and the little fill in a landing row or tile. Only its
 * size differs: `thick` is the card's, `thin` is the rows'.
 *
 * A recessed track in `--p-control` with a `--p-dim2` edge (3:1 on the panel
 * in every theme, high-contrast ones included), the fill in
 * `--p-accent-solid`. Corners are the theme's radius. No pct is a bar that
 * slides, and says no value. `stopped` is the failed look: a HATCHED fill in
 * `--p-dim` rather than another colour, which reads in every theme.
 */
export function ProgressBar({
  pct,
  size = 'thick',
  stopped,
  label,
  className,
  style
}: {
  /** 0-100, or null while nothing is known. */
  pct: number | null
  size?: 'thick' | 'thin'
  stopped?: boolean
  label?: string
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const value = pct === null || !Number.isFinite(pct) ? null : Math.max(0, Math.min(100, pct))
  const whole = value === null ? null : Math.round(value)
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={whole ?? undefined}
      aria-label={label}
      className={`p-progress${className ? ` ${className}` : ''}`}
      data-size={size}
      data-pct={whole ?? undefined}
      data-indeterminate={value === null && !stopped ? '' : undefined}
      data-stopped={stopped ? '' : undefined}
      style={style}
    >
      <span
        className="p-progress-fill"
        data-progress-fill
        style={value === null ? undefined : { width: `${value}%` }}
      />
    </span>
  )
}
