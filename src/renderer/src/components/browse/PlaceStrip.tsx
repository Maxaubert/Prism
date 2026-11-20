import type { JSX, ReactNode } from 'react'
import './place-strip.css'

/**
 * THE STRIP ABOVE A PLACE'S COLUMNS (#524): one 40 px line with the place's
 * name block at its start (an icon, the name, a dim line of facts) and its
 * verbs at its end. The zip's strip (`ArchiveStrip`) and the Recycle Bin's
 * (`BinStrip`) are this shell with their own words and buttons. No fill and no
 * accent of its own (the spec's Decision 4, #202); the buttons are
 * `.browse-place-button`, neutral row buttons.
 */
export function PlaceStrip({
  icon,
  name,
  nameTitle,
  facts,
  children,
  className = '',
  data
}: {
  icon: ReactNode
  name: string
  /** The name's tooltip, for a name the strip may cut short. */
  nameTitle?: string
  facts: string
  /** The verbs, `.browse-place-button`s. */
  children: ReactNode
  /** A class for the place's own rules (`browse-bin-strip`). */
  className?: string
  /** The place's `data-*` hooks (`data-archive-strip`, `data-testid`). */
  data?: Record<`data-${string}`, string | number | undefined>
}): JSX.Element {
  return (
    <div className={`browse-place-strip ${className}`.trim()} {...data}>
      <span className="browse-place-strip-name">
        {icon}
        <strong title={nameTitle}>{name}</strong>
        <span className="browse-place-strip-facts">{facts}</span>
      </span>
      <span className="browse-place-strip-verbs">{children}</span>
    </div>
  )
}