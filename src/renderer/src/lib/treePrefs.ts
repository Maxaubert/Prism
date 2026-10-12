import { createPref } from './prefs/createPref'

// The app's type size: the file tree's rows and the settings page both follow it,
// so one setting covers "make the text bigger". A saved setting (prefs/createPref.ts).

export type TreeSize = 'small' | 'default' | 'large'

export const TREE_SIZES: Array<{ id: TreeSize; name: string; font: number; row: number; indent: number; zoom: number }> = [
  { id: 'small', name: 'Small', font: 11.5, row: 22, indent: 11, zoom: 0.92 },
  { id: 'default', name: 'Default', font: 12.5, row: 26, indent: 13, zoom: 1 },
  { id: 'large', name: 'Large', font: 14, row: 31, indent: 15, zoom: 1.12 }
]

/**
 * ONE FILE ROW, WHEREVER FILES ARE LISTED (#257; owner, 2026-10-03: "the rows
 * are too big in explorer, and matching the ide sizing and look for that would
 * be nicer, more coherent and more efficient"). The project tree and the
 * Explorer's list both read their row from here: height and text size from the
 * size picked above, and the icon, the gap after it and the side padding from
 * the constants below. The Explorer's rows were 40px of 14px text with an 18px
 * icon; the tree's are 26px of 12.5px with a 14px one. A row changed in one
 * place and not the other is the drift this exists to stop.
 */
export const ROW_ICON = 14
export const ROW_GAP = 6
export const ROW_PAD_X = 8

export function rowLook(size: (typeof TREE_SIZES)[number]): {
  height: number
  font: number
  icon: number
  gap: number
  padX: number
} {
  return { height: size.row, font: size.font, icon: ROW_ICON, gap: ROW_GAP, padX: ROW_PAD_X }
}

const DEFAULT: TreeSize = 'default'

const sizePref = createPref<TreeSize>({
  key: 'prism.tree.size',
  parse: (v) => (TREE_SIZES.some((s) => s.id === v) ? (v as TreeSize) : DEFAULT),
  fallback: DEFAULT
})

export const setTreeSize = sizePref.set

export function useTreeSize(): (typeof TREE_SIZES)[number] {
  const id = sizePref.use()
  return TREE_SIZES.find((s) => s.id === id) ?? TREE_SIZES[1]
}

/* ---------- which side it lives on ---------- */

export type TreeSide = 'left' | 'right'

export const TREE_SIDES: Array<{ id: TreeSide; name: string }> = [
  { id: 'left', name: 'Left' },
  { id: 'right', name: 'Right' }
]

const sidePref = createPref<TreeSide>({
  key: 'prism.tree.side',
  parse: (v) => (v === 'right' ? 'right' : 'left'),
  fallback: 'left'
})

export const setTreeSide = sidePref.set
export const useTreeSide = sidePref.use
