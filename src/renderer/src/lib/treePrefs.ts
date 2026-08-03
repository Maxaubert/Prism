import { useSyncExternalStore } from 'react'

// The app's type size: the file tree's rows and the settings page both follow it,
// so one setting covers "make the text bigger". Same tiny-store shape as navScope.

export type TreeSize = 'small' | 'default' | 'large'

export const TREE_SIZES: Array<{ id: TreeSize; name: string; font: number; row: number; indent: number; zoom: number }> = [
  { id: 'small', name: 'Small', font: 11.5, row: 22, indent: 11, zoom: 0.92 },
  { id: 'default', name: 'Default', font: 12.5, row: 26, indent: 13, zoom: 1 },
  { id: 'large', name: 'Large', font: 14, row: 31, indent: 15, zoom: 1.12 }
]

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
