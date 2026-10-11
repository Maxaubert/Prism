import type { IBufferLine } from '@xterm/xterm'
import { cellText, type CellInfo } from './termCells'

/**
 * OSC 8 HYPERLINKS (#169): a program prints a label and says, in-band, which
 * uri it stands for (`ESC ] 8 ; params ; uri ST`, label, `ESC ] 8 ; ; ST`).
 * Claude Code prints its links this way once told the terminal takes them
 * (its `hyperlinks` setting, or a FORCE_HYPERLINK of the user's own: the app
 * no longer sets it, see `ptyEnv`), "PR #165" in its status line among them.
 *
 * xterm records which cells belong to a link, but keeps it internal (the
 * cell's `urlId`), with no public way to ask. So the panel FOLLOWS THE STREAM:
 * where the cursor was at the open, where it was at the close, and the text
 * between. MEASURED (Claude Code 2.1.296, bundled ConPTY, headless xterm,
 * 2026-10-11): ConPTY passes the sequence through, and the cursor at the open
 * and at the close bracket the label exactly ("OSC8LABEL" at row 9, cells 2 to
 * 11 of the alternate screen). This is the pure half: the parse, the spans and
 * the cell arithmetic. Cells are not characters (rule 11): every cell-to-text
 * step goes through `termCells`.
 */

/** The uri an OSC 8 sequence carries ('' is the close), or null when it is not
 *  OSC 8's `params;uri` at all. The uri is everything after the FIRST `;`. */
export function parseOsc8(data: string): { uri: string } | null {
  const at = data.indexOf(';')
  if (at < 0) return null
  return { uri: data.slice(at + 1) }
}

/** The only links the app opens (main and the preload check again). */
export const isWebLink = (uri: string): boolean => /^https?:\/\//i.test(uri)

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * WHERE AN OSC 8 LINK GOES, on a click, Open link or Copy link (review
 * 2026-10-11). xterm registers its OSC 8 provider before any other, and the
 * lowest one wins, so the hidden uri outranked the web-links match on the
 * visible text, both painted the link colour and with no confirm: output
 * printing `https://github.com/org/repo` over `https://evil.example/` opened
 * evil.example. A label that SHOWS an address (`shown`, the visible link under
 * it) on another host is taken at its word; any other label ("PR #165") opens
 * its uri. Hosts, not whole urls: a label is often a shortened form of its own
 * uri.
 */
export function osc8Target(uri: string, shown: string | null): string {
  if (!shown) return uri
  const want = hostOf(uri)
  return want !== null && want === hostOf(shown) ? uri : shown
}

/** Where a span's first row is now: an xterm marker on the normal screen (it
 *  follows the buffer as it trims), a plain line on the alternate one. */
export interface SpanAnchor {
  readonly line: number
  readonly isDisposed?: boolean
  dispose?(): void
}

export interface Osc8Span {
  anchor: SpanAnchor
  /** The first cell, on the anchor's row. */
  x: number
  /** How many rows below the anchor the span ends. */
  rows: number
  /** The cell just past the last one, on the end row. */
  endX: number
  uri: string
  /** What the cells held when the link was printed: the span stands only
   *  while they still hold it. */
  text: string
  alt: boolean
}

type Pos = readonly [line: number, x: number]

const before = (a: Pos, b: Pos): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])

const live = (s: Osc8Span): boolean => !s.anchor.isDisposed && s.anchor.line >= 0

const startOf = (s: Osc8Span): Pos => [s.anchor.line, s.x]
const endOf = (s: Osc8Span): Pos => [s.anchor.line + s.rows, s.endX]

const overlaps = (a: Osc8Span, b: Osc8Span): boolean =>
  before(startOf(a), endOf(b)) && before(startOf(b), endOf(a))

/** Spans kept for a terminal: a few hundred, newest last. */
export class Osc8Spans {
  private spans: Osc8Span[] = []

  constructor(private readonly cap = 300) {}

  /** A newer span over the same cells replaces the older one: a TUI redraws
   *  its links in place, and a ConPTY repaint sends them again. */
  add(span: Osc8Span): void {
    this.spans = this.spans.filter((s) => {
      if (live(s) && (s.alt !== span.alt || !overlaps(s, span))) return true
      s.anchor.dispose?.()
      return false
    })
    this.spans.push(span)
    while (this.spans.length > this.cap) this.spans.shift()?.anchor.dispose?.()
  }

  /** The span over cell (`line`, `x`) of one screen. */
  at(line: number, x: number, alt: boolean): Osc8Span | undefined {
    const p: Pos = [line, x]
    for (let i = this.spans.length - 1; i >= 0; i -= 1) {
      const s = this.spans[i]
      if (s.alt === alt && live(s) && !before(p, startOf(s)) && before(p, endOf(s))) return s
    }
    return undefined
  }

  /** The spans with a cell on rows `first` to `last` of one screen. */
  overlapping(first: number, last: number, alt: boolean): Osc8Span[] {
    return this.spans.filter(
      (s) => s.alt === alt && live(s) && s.anchor.line <= last && s.anchor.line + s.rows >= first
    )
  }

  /** Forget one screen's spans (a buffer switch), or all of them (a resize
   *  reflows the cells away from where they were). */
  clear(alt?: boolean): void {
    this.spans = this.spans.filter((s) => {
      if (alt !== undefined && s.alt !== alt) return true
      s.anchor.dispose?.()
      return false
    })
  }
}

/** A stretch of cells on one buffer row. */
export interface RowPiece {
  line: number
  x: number
  width: number
}

/** The span's cells, one piece per row. */
export function spanRows(span: Osc8Span, cols: number): RowPiece[] {
  const out: RowPiece[] = []
  for (let r = 0; r <= span.rows; r += 1) {
    const from = r === 0 ? span.x : 0
    const to = r === span.rows ? span.endX : cols
    if (to > from) out.push({ line: span.anchor.line + r, x: from, width: to - from })
  }
  return out
}

/** Whether any of `pieces` shares a cell with any of `taken`: a URL match
 *  inside an OSC 8 link is that link, painted once (review 2026-10-11). */
export function piecesOverlap(pieces: readonly RowPiece[], taken: readonly RowPiece[]): boolean {
  return pieces.some((p) => taken.some((t) => t.line === p.line && t.x < p.x + p.width && p.x < t.x + t.width))
}

/** Where cells `from` to `to` of a row sit in the row's TEXT (a wide
 *  character is two cells and one character). */
export function spanTextRange(row: readonly CellInfo[], from: number, to: number): { start: number; end: number } {
  const { index } = cellText(row)
  const at = (x: number): number => index[Math.min(Math.max(0, x), index.length - 1)]
  return { start: at(from), end: at(to) }
}

/** A buffer row's cells, for the cell arithmetic above. */
export function bufferRowCells(line: IBufferLine | undefined, cols: number): CellInfo[] | undefined {
  if (!line) return undefined
  const out: CellInfo[] = []
  for (let x = 0; x < cols; x += 1) {
    const cell = line.getCell(x)
    out.push({ chars: cell?.getChars() ?? '', width: cell?.getWidth() ?? 1 })
  }
  return out
}

/** What the span's cells hold now, or null when a row of it is gone. */
export function spanText(
  span: Osc8Span,
  cols: number,
  cellsOf: (line: number) => readonly CellInfo[] | undefined
): string | null {
  let text = ''
  for (const piece of spanRows(span, cols)) {
    const row = cellsOf(piece.line)
    if (!row) return null
    const { text: t } = cellText(row)
    const { start, end } = spanTextRange(row, piece.x, piece.x + piece.width)
    text += t.slice(start, end)
  }
  return text
}
