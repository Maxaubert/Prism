import type { CSSProperties } from 'react'

/**
 * The sweep rectangle's look (#257, #519): the Selection colour at a low
 * strength with a thin light edge, square-ish corners. One object, so the
 * Explorer's band (`SweepBand`) and the zip panel's band on the phone
 * (`ArchiveView`) cannot drift apart. `color-mix` against transparent keeps an
 * accent that is itself see-through see-through.
 *
 * The edge is the hue pulled toward the text colour: a pure accent edge
 * vanished into the rows it crossed when a mark was a solid accent fill
 * (MEASURED in the first screenshot, #257), and it still has to stand apart
 * from the marked rows' own edges, which are the same hue.
 */
export const SWEEP_BAND_LOOK: CSSProperties = {
  background: 'color-mix(in srgb, var(--p-sel-hue) 16%, transparent)',
  border: '1px solid color-mix(in srgb, var(--p-sel-hue-hi) 45%, var(--p-text))',
  borderRadius: 2
}