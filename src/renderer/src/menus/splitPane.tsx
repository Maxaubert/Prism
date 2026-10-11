/**
 * THE PINNED SPLIT PANE'S BAND MENU: what a right-click along the TOP BAND of
 * a pinned split pane shows (owner, 2026-09-03): where the pane sits, and
 * taking it out of the split. Opened by App's `PinnedPaneView`; lower down
 * the pane the file's own menu answers.
 */
import type { MenuItem } from '../components/ContextMenu'
import type { SplitDir } from '../lib/panes'
import { tickIf } from './fileVerbs'

/** The four places a split pane can sit, as a submenu (owner, 2026-09-03:
 *  "a tree structure ... so we don't bloat the options"). Shared by the
 *  pinned panes and the terminal dock. */
export const SPLIT_DIRS: ReadonlyArray<{ dir: SplitDir; label: string }> = [
  { dir: 'left', label: 'Left' },
  { dir: 'right', label: 'Right' },
  { dir: 'top', label: 'Top' },
  { dir: 'bottom', label: 'Bottom' }
]

export interface SplitPaneMenuContext {
  /** Where the pane sits now: its row is ticked. */
  dir: SplitDir
  /** Move the pane to another side. */
  onMove: (dir: SplitDir) => void
  /** Take the pane out of the split. */
  onClose: () => void
}

export function splitPaneMenu(ctx: SplitPaneMenuContext): MenuItem[] {
  return [
    {
      label: 'Split view position',
      children: SPLIT_DIRS.map((d) => ({
        label: d.label,
        icon: tickIf(d.dir === ctx.dir),
        onPick: () => ctx.onMove(d.dir)
      }))
    },
    { label: 'Remove from split view', onPick: ctx.onClose }
  ]
}
