import type { JSX } from 'react'

// The one spinner (structure cleanup, 2026-10-12; #524): an accent arc on a
// divider ring. `small` is the 16px one that sits beside a line of text (the
// archive's opening box, the search popup). It fades in after a moment
// (`delayed-loader`, CSS, so it survives a main-thread stall), so a quick wait
// shows nothing, and under reduced motion it turns slowly instead of fast.
// `className` sizes or places its box.
export function Spinner({ small, className = '' }: { small?: boolean; className?: string }): JSX.Element {
  return (
    <div className={`delayed-loader ${className}`} aria-hidden>
      <div
        className={`${small ? 'h-4 w-4 border-2' : 'h-9 w-9 border-[3px]'} animate-spin rounded-full border-[color:var(--p-divider)] border-t-[var(--color-accent-hi)] motion-reduce:[animation-duration:2s]`}
      />
    </div>
  )
}

/** A viewer still loading: the spinner, centred in its box. The caller's
 *  `className` sizes or places the box. */
export function LoadingState({ className }: { className: string }): JSX.Element {
  return (
    <div className={`grid place-items-center ${className}`}>
      <Spinner />
    </div>
  )
}