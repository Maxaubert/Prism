import { createPref } from './createPref'
import type { TreeSide } from './treePrefs'

// THE EXPLORER'S SIDEBAR POSITION, ITS OWN SETTING (#304; owner, 2026-10-07,
// after testing one shared row: "No, it should be two settings, one on the
// project tab and one on the explorer tab"). Settings > Explorer > Layout >
// Sidebar position. It moves the Explorer tab's places panel; the preview
// pane and its toggle take the other side. The project tree keeps its own
// row on Project settings (`prism.tree.side`, treePrefs.ts), and neither
// moves the other.

export type ExplorerSide = TreeSide

/** A stored side, made safe: anything but 'right' reads as Left. */
export function explorerSideOf(raw: unknown): ExplorerSide {
  return raw === 'right' ? 'right' : 'left'
}

const pref = createPref<ExplorerSide>({
  key: 'prism.explorer.side',
  parse: explorerSideOf,
  fallback: 'left'
})

export const setExplorerSide = (s: ExplorerSide): void => pref.set(explorerSideOf(s))
export const explorerSide = pref.get
export const useExplorerSide = pref.use

/** For tests: read the store again, as a fresh launch would. */
export const reloadExplorerSide = pref.reload
