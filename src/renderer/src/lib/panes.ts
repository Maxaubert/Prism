// The split-view panes: the live pane (the tab's current file, which paging
// drives) plus up to three PINNED panes, each a fixed file. Four windows at
// most - one per corner - and a fifth pin evicts the oldest pinned (never the
// live pane): FIFO, like the request said.

export type SplitDir = 'left' | 'right' | 'top' | 'bottom'

export interface PinnedPane {
  id: string
  /** The file, or for a TERMINAL pane a `term:<id>` sentinel that no real
   *  path can collide with, so every path-keyed rule keeps working. */
  path: string
  /** Where this pane asked to sit, relative to the live pane. */
  dir: SplitDir
  /** A shell pinned as a pane (2026-09-03, owner): two terminals side by
   *  side, or a terminal beside a file, through the same grid. */
  term?: string
}

export const MAX_PINNED = 3

/** The sentinel path a terminal pane wears. */
export const termPanePath = (termId: string): string => `term:${termId}`

/** Pin a shell as a pane. Re-pinning a pinned shell just moves it to `dir`. */
export function pinTermPane(
  panes: readonly PinnedPane[],
  id: string,
  termId: string,
  dir: SplitDir
): PinnedPane[] {
  const path = termPanePath(termId)
  const existing = panes.find((p) => p.term === termId)
  if (existing) return panes.map((p) => (p === existing ? { ...p, dir } : p))
  const next = [...panes, { id, path, dir, term: termId }]
  return next.length > MAX_PINNED ? next.slice(next.length - MAX_PINNED) : next
}

/** Pin a file. Re-pinning a pinned path just moves it to `dir`. */
export function pinPane(panes: readonly PinnedPane[], id: string, path: string, dir: SplitDir): PinnedPane[] {
  const existing = panes.find((p) => p.path.toLowerCase() === path.toLowerCase())
  if (existing) return panes.map((p) => (p === existing ? { ...p, dir } : p))
  const next = [...panes, { id, path, dir }]
  return next.length > MAX_PINNED ? next.slice(next.length - MAX_PINNED) : next
}

export function unpinPane(panes: readonly PinnedPane[], id: string): PinnedPane[] {
  return panes.filter((p) => p.id !== id)
}

export function isPinned(panes: readonly PinnedPane[], path: string): boolean {
  return panes.some((p) => p.path.toLowerCase() === path.toLowerCase())
}

/**
 * CSS grid-area strings for the live pane and each pinned pane, over a 2x2
 * grid. One pin splits along its direction (the pin takes the side it names);
 * two pins put the live pane on a half and the pins in quarters; three pins
 * fill the corners.
 */
export function paneAreas(panes: readonly PinnedPane[]): { live: string; pinned: string[] } {
  const n = panes.length
  if (n === 0) return { live: '1 / 1 / 3 / 3', pinned: [] }
  if (n === 1) {
    const d = panes[0].dir
    if (d === 'left') return { live: '1 / 2 / 3 / 3', pinned: ['1 / 1 / 3 / 2'] }
    if (d === 'right') return { live: '1 / 1 / 3 / 2', pinned: ['1 / 2 / 3 / 3'] }
    if (d === 'top') return { live: '2 / 1 / 3 / 3', pinned: ['1 / 1 / 2 / 3'] }
    return { live: '1 / 1 / 2 / 3', pinned: ['2 / 1 / 3 / 3'] }
  }
  if (n === 2) {
    // Live keeps a full half on the side opposite the FIRST pin; the two pins
    // stack as quarters on their side.
    const d = panes[0].dir
    if (d === 'left' || d === 'right') {
      const pinCol = d === 'left' ? '1 / 2' : '2 / 3'
      const liveCol = d === 'left' ? '2 / 3' : '1 / 2'
      return {
        live: `1 / ${liveCol.split(' / ')[0]} / 3 / ${liveCol.split(' / ')[1]}`,
        pinned: [`1 / ${pinCol.split(' / ')[0]} / 2 / ${pinCol.split(' / ')[1]}`, `2 / ${pinCol.split(' / ')[0]} / 3 / ${pinCol.split(' / ')[1]}`]
      }
    }
    const pinRow = d === 'top' ? '1 / 2' : '2 / 3'
    const liveRow = d === 'top' ? '2 / 3' : '1 / 2'
    return {
      live: `${liveRow.split(' / ')[0]} / 1 / ${liveRow.split(' / ')[1]} / 3`,
      pinned: [`${pinRow.split(' / ')[0]} / 1 / ${pinRow.split(' / ')[1]} / 2`, `${pinRow.split(' / ')[0]} / 2 / ${pinRow.split(' / ')[1]} / 3`]
    }
  }
  // Four corners: live TL, pins TR, BL, BR in age order.
  return { live: '1 / 1 / 2 / 2', pinned: ['1 / 2 / 2 / 3', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3'] }
}

const DIR_KEY = 'prism.split.dir'
const DIRS: SplitDir[] = ['left', 'right', 'top', 'bottom']

/** The remembered direction: what a bare "Open in split view" click uses. */
export function lastSplitDir(): SplitDir {
  const v = localStorage.getItem(DIR_KEY)
  return DIRS.includes(v as SplitDir) ? (v as SplitDir) : 'right'
}

export function saveSplitDir(dir: SplitDir): void {
  localStorage.setItem(DIR_KEY, dir)
}
