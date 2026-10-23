import { floorMark, opaqueOver, rainbowFillX, rainbowGradient, rainbowOn } from './markColours'
import { groundIsDark, nameInk, rainbowInk } from './nameInk'
import type { MarkOverlay, MarkState } from './tabMark'

/**
 * EVERY COLOUR A STRIP'S MARKS WEAR (#143), worked out once from what the
 * window paints. Pure, so both apps' strips colour the marks the same way.
 *
 * - The LINE colours (a run, a line, a Prompt edge) are the agent colours
 *   (`useAgentColors`), made opaque on the solid ground and held to 3:1 on
 *   every ground the mark can sit on. Where they already clear it nothing moves.
 * - The rainbow is the icon's seven, floored the same way, as a looping
 *   gradient along a line and down an edge.
 * - The FILL colours are Full's: SOLID (owner, 2026-10-10), so a see-through
 *   working colour (#112) is laid on the ground first, and NOT floored: the
 *   fill is the state's own colour. Finished with the rainbow on is the icon's
 *   seven, raw, across the whole tab (the rework's choice 1A).
 * - The name INK on each fill follows the owner's rule (`nameInk`), once per
 *   state colour; on the rainbow, once from its worst colour (`rainbowInk`).
 * - The OVERLAY is Minimal's working mark on a working fill. Classic's run is
 *   the NAME'S ink (owner, 2026-10-10: "if the tab is yellow ... the working bar
 *   that is on that tab, like the minimal bar, should be black and not like a
 *   faded arc yellow"). A working Powerline fill has no overlay: its edge
 *   pulses only on the tab in front (owner, 2026-10-10).
 */
export interface MarkPalette {
  line: Record<MarkState, string>
  rainbowX: string
  rainbowY: string
  /** A colour, or for a rainbow finish a gradient: a CSS background. */
  fill: Record<MarkState, string>
  ink: Record<MarkState, string>
  overlay: Record<MarkOverlay, string>
}

export function markPalette({
  colours,
  grounds,
  solidGround,
  text,
  rainbow
}: {
  colours: { working: string; finished: string; question: string; failed: string }
  /** Every ground a mark can sit on, opaque. */
  grounds: readonly string[]
  /** The window's own opaque ground. */
  solidGround: string
  /** The theme's text colour. */
  text: string
  rainbow: boolean
}): MarkPalette {
  const solid = {
    working: opaqueOver(colours.working, solidGround),
    done: opaqueOver(colours.finished, solidGround),
    question: opaqueOver(colours.question, solidGround),
    failed: opaqueOver(colours.failed, solidGround)
  }
  const line = {
    working: floorMark(solid.working, grounds),
    done: floorMark(solid.done, grounds),
    question: floorMark(solid.question, grounds),
    failed: floorMark(solid.failed, grounds)
  }
  const seven = rainbowOn(grounds)
  const fill = { ...solid, done: rainbow ? rainbowFillX() : solid.done }
  const dark = groundIsDark(solidGround)
  const ink = {
    working: nameInk(solid.working, text, dark),
    done: rainbow ? rainbowInk(text, dark) : nameInk(solid.done, text, dark),
    question: nameInk(solid.question, text, dark),
    failed: nameInk(solid.failed, text, dark)
  }
  return {
    line,
    rainbowX: rainbowGradient(seven, 'x'),
    rainbowY: rainbowGradient(seven, 'y'),
    fill,
    ink,
    overlay: { run: ink.working }
  }
}
