import type { CSSProperties, JSX } from 'react'

/**
 * The sweep rectangle (#257): the Selection colour (the accent while none is
 * picked) at a low strength with a thin light edge, Explorer's look in this
 * app's colours; Windows draws its drag box in the selection colour too.
 * `color-mix` against transparent keeps an accent that is itself see-through
 * see-through. Never animated: it is where the pointer is, and nothing else.
 * Its place is not a prop (#332): `useSweep` writes it straight onto the
 * element from the pointer handler, and it stays hidden until it has one.
 * On Windows 11 a mouse sweep's box is drawn natively by main (#338) in this
 * element's own computed colours, and this element stays mounted and placed
 * but hidden, ready to show the moment main says it cannot draw. The native
 * box's corners are square (Explorer's are too).
 *
 * It lived in the project tree's TreeRows until the tree went (2026-10-26).
 */
export function SweepBand({
  bandRef,
  as = 'li'
}: {
  bandRef: (el: HTMLElement | null) => void
  as?: 'li' | 'div'
}): JSX.Element {
  const style: CSSProperties = {
    display: 'none',
    background: 'color-mix(in srgb, var(--p-sel-hue) 16%, transparent)',
    // The edge is the hue pulled toward the text colour: a pure accent edge
    // vanished into the rows it crossed when a mark was a solid accent fill
    // (MEASURED in the first screenshot, #257), and it still has to stand
    // apart from the marked rows' own edges, which are the same hue.
    border: '1px solid color-mix(in srgb, var(--p-sel-hue-hi) 45%, var(--p-text))',
    borderRadius: 2
  }
  const Tag = as
  return (
    <Tag
      ref={bandRef}
      role={as === 'li' ? 'none' : undefined}
      aria-hidden
      data-sweep-band
      className="pointer-events-none absolute z-20"
      style={style}
    />
  )
}
