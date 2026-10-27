import { createPref } from './createPref'
import type { TreeSide } from './treePrefs'

// THE EXPLORER'S SIDEBAR POSITION (#304). Settings > Explorer > Layout >
// Sidebar position. It moves the Explorer tab's places panel; the preview
// pane and its toggle take the other side. (It had a twin for the project
// tree, `prism.tree.side`, until the project tabs went, 2026-10-26.)

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
