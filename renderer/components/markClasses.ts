import type { MarkMotion } from '../lib/tabMark'

/** The class in `styles/marks.css` that moves each motion. `flow` has one per
 *  axis (a line flows along x, a Prompt edge down y) and one for a whole Full
 *  fill; `still` moves nothing. */
export const MOTION_CLASS: Record<MarkMotion, string> = {
  run: 'p-agent-run',
  grow: 'p-mark-grow',
  breathe: 'p-mark-breathe',
  flow: 'p-mark-flow-x p-mark-flow-y p-mark-flow-fill',
  spin: 'p-mark-spin',
  still: ''
}

/** The class for a motion on a mark running along `axis`, or over a whole
 *  Full fill. */
export function motionClass(motion: MarkMotion | null, axis: 'x' | 'y' | 'fill' = 'x'): string {
  if (!motion) return ''
  if (motion === 'flow') return axis === 'x' ? 'p-mark-flow-x' : axis === 'y' ? 'p-mark-flow-y' : 'p-mark-flow-fill'
  return MOTION_CLASS[motion]
}
