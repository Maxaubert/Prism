import type { AgentIndicator } from '../host'

/**
 * WHICH MARK A TAB WEARS (#143; spec `docs/superpowers/specs/2026-10-10-
 * indicator-styles-design.md`, section 3, reworked by `2026-10-10-full-style-
 * rework-design.md`). Pure: the indicator style, the tab style, the tab's
 * state and whether it is in front go in; WHAT to draw, in WHICH colour role,
 * with WHICH motion comes out. Every rule of the owner's decisions lives here,
 * so a strip only draws what it is told.
 *
 * - Minimal: working is the running bar (flat) or the growing arrow edge
 *   (Prompt); finished, question and failed are a 3 px line (flat) or the whole
 *   edge (Prompt) in their colour.
 * - Ring: the spinner beside the name while working; everything else Minimal's.
 * - Full: a tab NOT in front is filled edge to edge in its state colour. Working
 *   on a flat tab carries Minimal's run on top (`overlay`); a working Powerline
 *   segment is the fill alone, with no edge (owner, 2026-10-10: the pulsing
 *   arrow belongs to the tab you are on). Finished is the icon's rainbow, solid,
 *   flowing (owner, 2026-10-10, choice 1A). The tab in front is never filled
 *   and shows Minimal's mark, so it stays obvious in every state.
 * - Off: no working mark; the attention marks as Minimal.
 * - Question breathes everywhere, failed is still, finished flows the rainbow
 *   (or stands still in the finished colour with the rainbow off).
 */

export type MarkState = 'working' | 'done' | 'question' | 'failed'
/** The core's word for a tab style: `flat` (this app's Classic) or `prompt`. */
export type MarkTabStyle = 'flat' | 'prompt'
export type MarkPlace = 'none' | 'run' | 'line' | 'edge' | 'ring' | 'fill'
export type MarkColour = 'working' | 'rule' | 'done' | 'rainbow' | 'question' | 'failed'
export type MarkMotion = 'run' | 'grow' | 'breathe' | 'flow' | 'spin' | 'still'
/** Minimal's working mark drawn ON a Full working fill: the run, flat tabs
 *  only (a Prompt fill has no edge). */
export type MarkOverlay = 'run'

export interface TabMark {
  place: MarkPlace
  colour: MarkColour | null
  motion: MarkMotion | null
  overlay?: MarkOverlay
}

export const NO_MARK: TabMark = { place: 'none', colour: null, motion: null }

export function resolveTabMark({
  indicator,
  tabStyle,
  state,
  active,
  rainbow
}: {
  indicator: AgentIndicator
  tabStyle: MarkTabStyle
  state: MarkState | null
  active: boolean
  rainbow: boolean
}): TabMark {
  if (!state) return NO_MARK
  const prompt = tabStyle === 'prompt'
  const filled = indicator === 'full' && !active
  if (state === 'working') {
    if (indicator === 'off') return NO_MARK
    if (indicator === 'ring') return { place: 'ring', colour: 'working', motion: 'spin' }
    // The fill itself stands still; the mark on top of it moves.
    if (filled) return prompt ? { place: 'fill', colour: 'working', motion: null } : { place: 'fill', colour: 'working', motion: null, overlay: 'run' }
    // On the tab in front the growing edge wears the top rule's colour, so at
    // full length rule and edge read as one line bending down.
    if (prompt) return { place: 'edge', colour: active ? 'rule' : 'working', motion: 'grow' }
    return { place: 'run', colour: 'working', motion: 'run' }
  }
  const motion: MarkMotion = state === 'question' ? 'breathe' : state === 'done' && rainbow ? 'flow' : 'still'
  const colour: MarkColour = state === 'done' ? (rainbow ? 'rainbow' : 'done') : state
  if (filled) return { place: 'fill', colour, motion }
  return { place: prompt ? 'edge' : 'line', colour, motion }
}
