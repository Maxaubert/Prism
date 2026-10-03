import { useSyncExternalStore } from 'react'

// The app's type size: the file tree's rows and the settings page both follow it,
// so one setting covers "make the text bigger". Same tiny-store shape as navScope.

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

const KEY = 'prism.tree.size'
const DEFAULT: TreeSize = 'default'

function load(): TreeSize {
  try {
    const v = localStorage.getItem(KEY)
    return TREE_SIZES.some((s) => s.id === v) ? (v as TreeSize) : DEFAULT
  } catch {
    return DEFAULT
  }
}

let size: TreeSize = load()
const listeners = new Set<() => void>()

export function setTreeSize(s: TreeSize): void {
  localStorage.setItem(KEY, s)
  size = s
  listeners.forEach((l) => l())
}

export function useTreeSize(): (typeof TREE_SIZES)[number] {
  const id = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => size
  )
  return TREE_SIZES.find((s) => s.id === id) ?? TREE_SIZES[1]
}

/* ---------- following the open file ---------- */

// Whether the tree scrolls to keep the open file in view. Same store, same
// listeners: one preference file for the sidebar's behaviour.

const AUTO_KEY = 'prism.tree.autoscroll'

function loadAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0'
  } catch {
    return true
  }
}

let autoScroll = loadAuto()

export function setAutoScroll(on: boolean): void {
  autoScroll = on
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0')
  } catch {
    /* no storage: it lasts the session */
  }
  listeners.forEach((l) => l())
}

export function useAutoScroll(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => autoScroll
  )
}

/* ---------- which side it lives on ---------- */

export type TreeSide = 'left' | 'right'

export const TREE_SIDES: Array<{ id: TreeSide; name: string }> = [
  { id: 'left', name: 'Left' },
  { id: 'right', name: 'Right' }
]

const SIDE_KEY = 'prism.tree.side'

function loadSide(): TreeSide {
  try {
    return localStorage.getItem(SIDE_KEY) === 'right' ? 'right' : 'left'
  } catch {
    return 'left'
  }
}

let side: TreeSide = loadSide()

export function setTreeSide(s: TreeSide): void {
  side = s
  try {
    localStorage.setItem(SIDE_KEY, s)
  } catch {
    /* no storage: it lasts the session */
  }
  listeners.forEach((l) => l())
}

export function useTreeSide(): TreeSide {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => side
  )
}
