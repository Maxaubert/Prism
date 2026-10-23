/**
 * CELLS ARE NOT CHARACTERS (code review 2026-09-24, #20 and #25). The screen
 * counts cells: a wide character is two (the second a spacer of width 0), an
 * emoji is one character but two UTF-16 units, a combining sequence is one
 * cell holding several. The text a link search or a rewrite works on is a
 * string, indexed in UTF-16 units. Mixing the two put the cursor one cell
 * left of the shell's after every resize (a prompt ending in a space) and
 * moved a link's edges by one after an emoji. So the text is built HERE, cell
 * by cell, with the index where each cell's text starts, and every caller
 * converts through that index rather than by counting.
 */
export interface CellInfo {
  /** What the cell holds; '' for an empty cell and for a wide character's spacer. */
  chars: string
  /** 1, 2 for a wide character, 0 for its spacer. */
  width: number
}

export interface CellText {
  /** Empty cells as spaces, spacers as nothing: what translateToString gives. */
  text: string
  /** index[i] is where cell i's text starts in `text`; a spacer shares its
   *  character's. index[cells.length] is text.length. */
  index: number[]
  /** The cell just past the last one holding anything. */
  textEnd: number
}

export function cellText(cells: readonly CellInfo[]): CellText {
  let text = ''
  let textEnd = 0
  const index: number[] = []
  cells.forEach((cell, i) => {
    if (cell.width === 0) {
      index.push(i > 0 ? index[i - 1] : text.length)
      return
    }
    index.push(text.length)
    text += cell.chars || ' '
    if (cell.chars !== '') textEnd = i + Math.max(1, cell.width)
  })
  index.push(text.length)
  return { text, index, textEnd }
}

/**
 * Where a cursor `back` cells before (or, negative, after) the position
 * (`row`, `col`) lands on a screen `cols` wide, following the wrap. Rows are
 * never walked above 0.
 */
export function cellFrom(row: number, col: number, back: number, cols: number): { row: number; col: number } {
  let r = row
  let c = col - back
  while (c < 0 && r > 0) {
    c += cols
    r -= 1
  }
  while (c >= cols) {
    c -= cols
    r += 1
  }
  return { row: r, col: Math.max(0, c) }
}

/** What these readers need of xterm's buffer: no xterm import, so they test
 *  on plain objects. */
export interface CellLike {
  getChars(): string
  getWidth(): number
}
export interface LineLike {
  isWrapped: boolean
  /** With `into`, xterm loads the cell into it and returns it, allocating
   *  nothing (the 2026-10-16 perf review: a fresh cell per read was ~6-12k
   *  allocations per live link scan per tab, millions per full backlog). */
  getCell(x: number, into?: CellLike): CellLike | undefined
}
export interface BufferLike {
  length: number
  getLine(y: number): LineLike | undefined
}

/** A buffer row's cells (audit 2026-10-12: moved here from termOsc8, so every
 *  read of a row into cells is this module's). `scratch` (xterm's
 *  `getNullCell()`) is the one cell every read loads into: each cell's chars
 *  and width are copied out before the next read overwrites it. */
export function bufferRowCells(
  line: Pick<LineLike, 'getCell'> | undefined,
  cols: number,
  scratch?: CellLike
): CellInfo[] | undefined {
  if (!line) return undefined
  const out: CellInfo[] = []
  for (let x = 0; x < cols; x += 1) {
    const cell = line.getCell(x, scratch)
    out.push({ chars: cell?.getChars() ?? '', width: cell?.getWidth() ?? 1 })
  }
  return out
}

export interface LogicalLine extends CellText {
  /** Its first and last buffer rows, across wraps. */
  first: number
  last: number
  /** Every cell's width. */
  widths: number[]
}

/** The LOGICAL line holding buffer row `y`: its first and last rows across
 *  wraps, every cell's width, the joined text, its index and the cell just
 *  past the last printed one. Moved here from TerminalPanel (audit
 *  2026-10-12). */
export function logicalLine(b: BufferLike, cols: number, y: number): LogicalLine {
  let first = y
  while (first > 0 && b.getLine(first)?.isWrapped) first -= 1
  let last = y
  while (last + 1 < b.length && b.getLine(last + 1)?.isWrapped) last += 1
  const cells: CellInfo[] = []
  for (let i = first; i <= last; i += 1) cells.push(...(bufferRowCells(b.getLine(i), cols) ?? []))
  const { text, index, textEnd } = cellText(cells)
  return { first, last, widths: cells.map((c) => c.width), text, index, textEnd }
}

/** Where the cell at buffer row `row`, column `col` starts in the line's
 *  TEXT, clamped to the line: the one conversion from a cell to a character. */
export function charAtCell(line: LogicalLine, cols: number, row: number, col: number): number {
  return line.index[Math.min(Math.max(0, (row - line.first) * cols + col), line.index.length - 1)]
}
