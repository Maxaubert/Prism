import { NAME_FLIP } from './nameInk'
import { contrastRatio } from './termAnsi'

/** The knob on a dark theme: the near-black the on-accent ink has always been. */
export const KNOB_DARK = '#0b0b0f'
/** The knob on a light theme. */
export const KNOB_LIGHT = '#ffffff'

/**
 * THE ON SWITCH'S KNOB (owner, 2026-10-10: "keep that to being black on dark
 * themes and white on light themes ... only when the color is very close").
 * Before, the knob was `--p-on-accent`, whichever of white and near-black read
 * better on the accent, so it changed with every accent. Now it follows the
 * THEME, like a tab name: black when the ground is dark (grey and darker,
 * measured, never read off a name), white when it is light, and the opposite
 * only where that default reads under 2:1 (`NAME_FLIP`, the tab names' own
 * line) on the switch's ON track. Decided per colour, never per frame. A very
 * light accent gives a black knob on a light theme; a very dark one a white
 * knob on a dark theme.
 */
export function switchKnob(track: string, darkGround: boolean): string {
  const ink = darkGround ? KNOB_DARK : KNOB_LIGHT
  if (contrastRatio(ink, track) >= NAME_FLIP) return ink
  return darkGround ? KNOB_LIGHT : KNOB_DARK
}
