/**
 * THE THEME WALL'S GEOMETRY AND KEYS (#298, spec 3.1), pure so they are
 * testable. The wall is six across, three when it is too narrow for six
 * cards of 124px (three across, each half is three rows of its own; six
 * across, the middle row holds the end of the dark half and the start of the
 * light, as the approved mockup does). Collapsed, only the row holding the chosen
 * theme is shown; the arrows walk every card, opening the wall as they leave
 * that row.
 */

export const WALL_COLS = 6
export const WALL_COLS_NARROW = 3
/** The narrowest a card may be before the wall drops to three across. */
export const CARD_MIN = 124
/** Gaps: 20px between rows, 16px between columns; 10px padding round it. */
export const GAP_X = 16
export const GAP_Y = 20
export const WALL_PAD = 10

/** The motion, from the approved mockup (owner, 2026-10-06). */
export const WALL_EASE = 'cubic-bezier(.33,1,.68,1)'
export const WALL_OPEN_MS = 270
export const WALL_CLOSE_MS = 220
/** The other rows fade and rise in, and fade out a little faster. */
export const CARD_IN_MS = 220
export const CARD_OUT_MS = 130
export const CARD_RISE = 6

/** How many across fit a wall this wide (its padding included). */
export function columnsFor(width: number): number {
  const six = WALL_COLS * CARD_MIN + (WALL_COLS - 1) * GAP_X + 2 * WALL_PAD
  return width >= six ? WALL_COLS : WALL_COLS_NARROW
}

export const rowOf = (index: number, cols: number): number => Math.floor(index / cols)

/** The cards shown: all of them open, else the chosen card's row. A chosen
 *  card that is not on the wall (none) shows the first row. */
export function visibleIndices(n: number, cols: number, chosen: number, open: boolean): number[] {
  const all = Array.from({ length: n }, (_, i) => i)
  if (open) return all
  const row = rowOf(Math.max(0, chosen), cols)
  return all.filter((i) => rowOf(i, cols) === row)
}

/**
 * Where a key moves the chosen card, or -1 for a key the wall does not take.
 * Left and Right wrap through the whole list; Down and Up go a row, wrapping
 * by column (a short last row is skipped over); Home and End go to the ends.
 */
export function wallTarget(i: number, key: string, n: number, cols: number): number {
  if (n <= 0) return -1
  const rows = Math.ceil(n / cols)
  const col = i % cols
  const r = Math.floor(i / cols)
  switch (key) {
    case 'ArrowRight':
      return (i + 1) % n
    case 'ArrowLeft':
      return (i - 1 + n) % n
    case 'ArrowDown': {
      const j = i + cols
      return j < n ? j : col
    }
    case 'ArrowUp': {
      if (r > 0) return i - cols
      const j = (rows - 1) * cols + col
      return j < n ? j : j - cols
    }
    case 'Home':
      return 0
    case 'End':
      return n - 1
    default:
      return -1
  }
}

/** When a card fades in on opening: the rows nearest the one in view first. */
export function staggerDelay(row: number, keptRow: number): number {
  const d = Math.max(0, Math.abs(row - keptRow) - 1)
  return 30 + Math.min(d, 2) * 45
}
