import { useEffect, useState, type JSX } from 'react'
import { onCopied } from '../lib/copyNotice'
import { LAYER } from './layers'

/** How long the badge stays before it fades. */
export const COPIED_BADGE_MS = 1200
/** Its fade out, after which it leaves the page. */
const FADE_MS = 200

/**
 * THE "COPIED" BADGE (owner, 2026-09-23: "a badge appear at the bottom center of
 * the screen saying copied"). One per window, mounted by the host; it answers
 * every successful `copyText`. Neutral like the dropdowns (the ground's
 * control grey and its hairline), no shadow, never in the way of a click. A
 * second copy restarts the clock rather than stacking a second badge.
 *
 * IT IS IN THE PAGE ONLY WHILE IT SHOWS (#58). It used to sit there empty,
 * a permanent status line and live region, and in Prism that was the FIRST of
 * each on the page: the player's volume readout and its sound notice are
 * found that way, and Prism's e2e read the badge's empty line instead
 * (MEASURED). Now it arrives with its word, which is also what a screen
 * reader announces, and goes after its fade.
 */
export default function CopiedBadge(): JSX.Element | null {
  const [phase, setPhase] = useState<'gone' | 'shown' | 'leaving'>('gone')
  useEffect(() => {
    let fade: number | undefined
    let gone: number | undefined
    const off = onCopied(() => {
      window.clearTimeout(fade)
      window.clearTimeout(gone)
      setPhase('shown')
      fade = window.setTimeout(() => setPhase('leaving'), COPIED_BADGE_MS)
      gone = window.setTimeout(() => setPhase('gone'), COPIED_BADGE_MS + FADE_MS)
    })
    return () => {
      off()
      window.clearTimeout(fade)
      window.clearTimeout(gone)
    }
  }, [])
  if (phase === 'gone') return null
  return (
    <div
      data-copied-badge={phase === 'shown' ? 'shown' : 'hidden'}
      role="status"
      className={`pointer-events-none fixed bottom-6 left-1/2 ${LAYER.toast} -translate-x-1/2 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-control)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--p-text)] transition-opacity duration-200 ease-out ${
        phase === 'shown' ? 'opacity-100' : 'opacity-0'
      }`}
    >
      Copied
    </div>
  )
}
