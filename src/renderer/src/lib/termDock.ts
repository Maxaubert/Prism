// Where the terminal docks and how big it is. The edge is global (a habit, not
// a per-project fact) and there is ONE remembered size per axis: a bottom dock
// and a top dock share their height, left and right share their width.

export type DockEdge = 'bottom' | 'top' | 'right' | 'left'

const EDGES: DockEdge[] = ['bottom', 'top', 'right', 'left']
const DOCK_KEY = 'prism.term.dock'
const SIZE_KEY = { y: 'prism.term.h', x: 'prism.term.w' } as const
const DEFAULT_SIZE = { y: 240, x: 360 } as const
const MIN = 90

/** Flex direction for the viewer+panel container. The viewer stays FIRST in
 *  the DOM whatever the edge, so focus order never depends on layout. */
export function dockFlex(edge: DockEdge): 'column' | 'column-reverse' | 'row' | 'row-reverse' {
  switch (edge) {
    case 'bottom':
      return 'column'
    case 'top':
      return 'column-reverse'
    case 'right':
      return 'row'
    case 'left':
      return 'row-reverse'
  }
}

/** Which remembered size an edge uses: heights for bottom/top, widths for left/right. */
export function dockAxis(edge: DockEdge): 'x' | 'y' {
  return edge === 'bottom' || edge === 'top' ? 'y' : 'x'
}

/** Usable at both ends: never squeezed below a few lines, never eating the viewer. */
export function clampTermSize(px: number, total: number): number {
  return Math.round(Math.min(Math.max(px, MIN), total * 0.8))
}

export function loadDock(): DockEdge {
  const v = localStorage.getItem(DOCK_KEY)
  return EDGES.includes(v as DockEdge) ? (v as DockEdge) : 'bottom'
}

export function saveDock(edge: DockEdge): void {
  localStorage.setItem(DOCK_KEY, edge)
}

export function loadTermSize(axis: 'x' | 'y'): number {
  const v = Number(localStorage.getItem(SIZE_KEY[axis]))
  return Number.isFinite(v) && v >= MIN ? Math.round(v) : DEFAULT_SIZE[axis]
}

export function saveTermSize(axis: 'x' | 'y', px: number): void {
  localStorage.setItem(SIZE_KEY[axis], String(Math.round(px)))
}
