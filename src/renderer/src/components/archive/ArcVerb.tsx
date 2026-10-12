import type { JSX } from 'react'

/**
 * One verb in the archive's own row of them: a quiet pill, icon then label.
 *
 * Deliberately not the row hover-verbs that were tried and rejected twice
 * (#68): these act on the whole archive, they are always in the same place,
 * and nothing appears or disappears under the pointer.
 */
export function ArcVerb({
  label,
  path,
  onClick,
  disabled
}: {
  label: string
  /** The icon's SVG path data, drawn in currentColor. */
  path: string
  onClick: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="no-drag flex h-[26px] items-center gap-1.5 rounded-[var(--p-radius-sm)] border border-[color:var(--p-divider)] px-2.5 text-[11.5px] text-[var(--p-text-soft)] transition-colors hover:border-[color:var(--p-accent-hi)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] disabled:cursor-default disabled:opacity-50 disabled:hover:border-[color:var(--p-divider)] disabled:hover:bg-transparent"
    >
      <svg
        viewBox="0 0 24 24"
        width={12}
        height={12}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 opacity-80"
        aria-hidden
      >
        <path d={path} />
      </svg>
      {label}
    </button>
  )
}
