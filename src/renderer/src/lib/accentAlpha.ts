// THE ACCENT CAN BE SEE-THROUGH (#249; owner, 2026-10-02: "in prism the accent
// colour should be able to have an alpha value", and of the ways offered, FILLS
// ONLY). The alpha reaches the accent's fills (the selection, buttons, chips);
// every colour sum in theme.ts still works on opaque hex, so anything derived
// from the accent is handed the colour as SEEN, composited over its ground,
// never a string with an alpha it would misparse. Pure, so it is tested.
//
// Since the colour picker moved into prism-term-core (#249 rework, PT #112),
// the alpha is set in the Accent row's own picker, not a slider of its own
// (owner, 2026-10-03: alpha "should be built into the colour pickers ... it
// should not be a separate opacity setting"). The colour maths is the core's
// (`alphaHex`, `composite`, `selectionFor`); what stays here is how the
// accent's alpha is STORED: a number beside the accent, since a scheme accent
// is an id, not a hex, and must keep its palette for the visualizer.

import { withAlpha } from 'prism-term-core/renderer/lib/colour'

/** The lowest alpha the picker offers. Below a tenth a fill stops reading as one. */
export const ALPHA_MIN = 0.1
export const ALPHA_MAX = 1

/** The lowest alpha a stored value may hold, in whole 1/255 steps. */
const MIN_BYTE = Math.ceil(ALPHA_MIN * 255)

/**
 * A stored alpha, made safe: missing, not a number, or anything a hand-edited
 * profile might hold reads as fully solid, and the rest is held to the range
 * in 1/255 steps (every alpha stored anywhere is, so a typed `...81` reads back
 * as `...81`). A style saved before #249 has none, so it reads as 1 and looks
 * as it did.
 */
export function accentAlphaOf(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
  const byte = Math.round(Math.min(ALPHA_MAX, Math.max(ALPHA_MIN, raw)) * 255)
  return Math.max(MIN_BYTE, byte) / 255
}

/** A fill token for `colour` at `alpha`: the plain hex when solid, so a style
 *  at 100% publishes exactly the value it always did, and `#rrggbbaa` below
 *  (never `rgba()`: the core's tokens are hex, and so are these). */
export function fillOf(colour: string, alpha: number): string {
  const a = accentAlphaOf(alpha)
  return a >= 1 ? colour : withAlpha(colour, a)
}
