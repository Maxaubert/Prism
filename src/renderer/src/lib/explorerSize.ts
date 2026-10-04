import { useSyncExternalStore } from 'react'
import { TREE_SIZES, rowLook } from './treePrefs'

// HOW BIG THE EXPLORER'S ROWS ARE (owner, 2026-10-03: "let there be size
// options for explorer in the appearance menu, let the current be medium the
// old be big, and make a slightly smaller version too"). Settings > Style >
// Explorer size. Rows, text and icon move together, so a size is one look and
// never a row stretched round small text.
//
// Medium is the project tree's own row at its default size (#257), which is
// what the Explorer has drawn since. It is a fixed look, not the tree's size
// setting: that one is "Font size" on General and also scales the sidebar and
// Settings, and the owner asked for sizes of the Explorer alone. So the tree
// keeps its own setting and this changes nothing outside the Explorer's list.

export type ExplorerSize = 'small' | 'medium' | 'large'

export interface ExplorerRow {
  height: number
  font: number
  icon: number
  gap: number
  padX: number
}

const medium: ExplorerRow = rowLook(TREE_SIZES.find((s) => s.id === 'default') ?? TREE_SIZES[1])

export const EXPLORER_SIZES: Array<{ id: ExplorerSize; name: string; row: ExplorerRow }> = [
  // A step under Medium: the tree's own Small row, its icon and gap scaled
  // down with the text so the row keeps Medium's proportions.
  { id: 'small', name: 'Small', row: { height: 22, font: 11.5, icon: 12, gap: 5, padX: medium.padX } },
  { id: 'medium', name: 'Medium', row: medium },
  // The Explorer as it was before #257: 40px rows of 15px text, an 18px icon,
  // 12px after it and 16px at the sides (browse.css on main, 2026-10-02).
  { id: 'large', name: 'Large', row: { height: 40, font: 15, icon: 18, gap: 12, padX: 16 } }
]

const KEY = 'prism.explorer.size'
const DEFAULT: ExplorerSize = 'medium'

/** A stored size, made safe: anything but a known id reads as Medium. */
export function explorerSizeOf(raw: unknown): ExplorerSize {
  return EXPLORER_SIZES.some((s) => s.id === raw) ? (raw as ExplorerSize) : DEFAULT
}

function load(): ExplorerSize {
  try {
    return explorerSizeOf(localStorage.getItem(KEY))
  } catch {
    return DEFAULT
  }
}

let size: ExplorerSize = load()
const listeners = new Set<() => void>()

export function setExplorerSize(s: ExplorerSize): void {
  size = explorerSizeOf(s)
  try {
    localStorage.setItem(KEY, size)
  } catch {
    /* no storage: it lasts the session */
  }
  listeners.forEach((l) => l())
}

export function explorerSize(): ExplorerSize {
  return size
}

export function explorerRow(id: ExplorerSize): ExplorerRow {
  return (EXPLORER_SIZES.find((s) => s.id === id) ?? EXPLORER_SIZES[1]).row
}

/** The column header's height for a size: a few pixels taller than a row,
 *  and Large's own 36px (the header before #257). It is also the band the
 *  sidebar's first heading and a text preview's first line are centred in
 *  (#283; owner, 2026-10-04: "the position of the sorting bar ... that's the
 *  height I want the txt files to start at and the sidebar to start at"), so
 *  the three panels' first lines are one line across the window. */
export function explorerHeadHeight(id: ExplorerSize): number {
  return id === 'large' ? 36 : explorerRow(id).height + 6
}

export function useExplorerSize(): ExplorerSize {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => size
  )
}

/** For tests: read the store again, as a fresh launch would. */
export function reloadExplorerSize(): void {
  size = load()
}
