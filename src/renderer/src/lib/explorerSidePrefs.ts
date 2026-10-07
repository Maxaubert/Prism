import { useSyncExternalStore } from 'react'
import type { TreeSide } from './treePrefs'

// THE EXPLORER'S SIDEBAR POSITION, ITS OWN SETTING (#304; owner, 2026-10-07,
// after testing one shared row: "No, it should be two settings, one on the
// project tab and one on the explorer tab"). Settings > Explorer > Layout >
// Sidebar position. It moves the Explorer tab's places panel; the preview
// pane and its toggle take the other side. The project tree keeps its own
// row on Project settings (`prism.tree.side`, treePrefs.ts), and neither
// moves the other.

export type ExplorerSide = TreeSide

const KEY = 'prism.explorer.side'

/** A stored side, made safe: anything but 'right' reads as Left. */
export function explorerSideOf(raw: unknown): ExplorerSide {
  return raw === 'right' ? 'right' : 'left'
}

function load(): ExplorerSide {
  try {
    return explorerSideOf(localStorage.getItem(KEY))
  } catch {
    return 'left'
  }
}

let side: ExplorerSide = load()
const listeners = new Set<() => void>()

export function setExplorerSide(s: ExplorerSide): void {
  side = explorerSideOf(s)
  try {
    localStorage.setItem(KEY, side)
  } catch {
    /* no storage: it lasts the session */
  }
  listeners.forEach((l) => l())
}

export function explorerSide(): ExplorerSide {
  return side
}

export function useExplorerSide(): ExplorerSide {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => side
  )
}

/** For tests: read the store again, as a fresh launch would. */
export function reloadExplorerSide(): void {
  side = load()
}
