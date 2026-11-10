// THE GRID'S ARROW KEYS (zoom grid, Stage 5, 2026-11-09; spec 5.2). Pure: the
// list owns the effects (focus, marks, scroll). Explorer's grid rules, which
// the owner knows: Left and Right step one item and do not wrap, Up and Down a
// whole line, Down from the line above a short last line lands on the LAST
// item, Home and End are the ends, Page keys go a screen less one line.
//
// Left and Right are the grid's alone. In the list they stay the viewer's
// (owner, 2026-09-01), so `gridKey` answers null for them there.

import type { KeyLike } from './listKeys'

export type GridDir = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'pageup' | 'pagedown'

/**
 * Where a key lands among `count` items laid `cols` to a line, from `from`
 * (-1: nothing focused yet). `lines` is the number of lines in view, for the
 * Page keys. Null when there is nothing to land on.
 */
export function gridStep(
  count: number,
  cols: number,
  from: number,
  to: GridDir,
  lines: number
): number | null {
  if (count <= 0) return null
  const last = count - 1
  const width = Math.max(1, cols)
  if (to === 'home') return 0
  if (to === 'end') return last
  if (from < 0) return to === 'up' || to === 'left' || to === 'pageup' ? last : 0
  const here = Math.min(from, last)
  switch (to) {
    case 'left':
      return Math.max(0, here - 1)
    case 'right':
      return Math.min(last, here + 1)
    case 'up':
      return here - width >= 0 ? here - width : here
    case 'down': {
      if (here + width <= last) return here + width
      // Past the end: Explorer goes to the last item unless this already is
      // in the last line.
      return Math.floor(here / width) === Math.floor(last / width) ? here : last
    }
    case 'pageup':
      return Math.max(0, here - Math.max(1, lines - 1) * width)
    case 'pagedown':
      return Math.min(last, here + Math.max(1, lines - 1) * width)
  }
}

const DIRS: Record<string, GridDir> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown'
}

export interface GridKey {
  to: GridDir
  /** 'move': pick the item; 'extend': Shift, the marks run from the anchor
   *  (an index range, as Explorer's grid does); 'focus': Ctrl, the focus
   *  moves and the marks do not. */
  mode: 'move' | 'extend' | 'focus'
}

/** Which grid move this press is, or null (not an arrow key, an Alt chord
 *  which is history or parent, Ctrl+Shift, Meta; and, outside a grid, Left and
 *  Right, which belong to the viewer). */
export function gridKey(e: KeyLike, inGrid: boolean): GridKey | null {
  if (!inGrid || e.metaKey || e.altKey) return null
  const to = DIRS[e.key]
  if (!to) return null
  if (e.ctrlKey && e.shiftKey) return null
  return { to, mode: e.ctrlKey ? 'focus' : e.shiftKey ? 'extend' : 'move' }
}
