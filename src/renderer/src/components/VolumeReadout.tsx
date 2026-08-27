import { useEffect, useState, type JSX } from 'react'
import { IconMute, IconVol } from './icons'

/**
 * The on-picture volume readout (2026-08-27).
 *
 * Shown for a moment after any volume change - the wheel, the keys, the
 * slider - and mounted/unmounted rather than faded, the same rule the
 * transport learned in fullscreen: a layer taken to opacity 0 inside a
 * fullscreen element is composited once and never repainted.
 */
export function VolumeReadout({
  flash,
  vol,
  muted
}: {
  flash: number
  vol: number
  muted: boolean
}): JSX.Element | null {
  // Two pieces of state on purpose. `seen` is which flash this is, and `open`
  // is whether to draw it: folding them into one meant the timer's close was
  // undone by the very next render, which compared the (unchanged) flash
  // against the closed state and opened it again, for ever.
  const [seen, setSeen] = useState(0)
  const [open, setOpen] = useState(false)
  if (flash !== seen) {
    setSeen(flash)
    setOpen(flash > 0)
  }
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => setOpen(false), 1200)
    return () => window.clearTimeout(t)
  }, [open, flash])
  if (!open) return null
  const pct = Math.round((muted ? 0 : vol) * 100)
  const boosted = pct > 100
  return (
    <div
      className="pointer-events-none absolute right-4 top-4 z-40 flex items-center gap-2.5 rounded-full bg-black/70 px-3.5 py-2 text-[var(--p-text)] shadow-[0_8px_20px_rgba(0,0,0,.45)] backdrop-blur-sm"
      style={{ animation: 'prism-chrome-in 140ms ease-out' }}
      aria-live="polite"
    >
      {muted || pct === 0 ? IconMute : IconVol}
      <span className="relative h-1 w-24 overflow-hidden rounded-full bg-white/20">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.min(100, (pct / 200) * 100)}%`,
            background: boosted ? 'var(--color-accent-hi)' : 'var(--p-text)'
          }}
        />
        {/* Where 100% is: the halfway mark on a bar that runs to 200. */}
        <span className="absolute inset-y-0 left-1/2 w-px bg-black/50" />
      </span>
      <span
        className={`w-11 text-right text-[13px] font-semibold tabular-nums ${
          boosted ? 'text-[var(--color-accent-hi)]' : ''
        }`}
      >
        {pct}%
      </span>
    </div>
  )
}
