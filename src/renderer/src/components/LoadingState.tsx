import type { JSX } from 'react'

// The one spinner (structure cleanup, 2026-10-12): an accent arc on a divider
// ring. `small` is the 16px one that sits beside a line of text.
export function Spinner({ small }: { small?: boolean }): JSX.Element {
  return (
    <div
      className={`${small ? 'h-4 w-4 border-2' : 'h-9 w-9 border-[3px]'} animate-spin rounded-full border-[color:var(--p-divider)] border-t-[var(--color-accent-hi)]`}
    />
  )
}

/** A viewer still loading: the spinner, centred in its box. `delayed-loader`
 *  keeps it invisible for the first moment (CSS, so it survives a main-thread
 *  stall) and fades it in after, so a quick load shows nothing at all. The
 *  caller's `className` sizes or places the box. */
export function LoadingState({ className }: { className: string }): JSX.Element {
  return (
    <div className={`delayed-loader grid place-items-center ${className}`}>
      <Spinner />
    </div>
  )
}
