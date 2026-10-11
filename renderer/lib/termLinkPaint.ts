import type { IBufferLine, IDecoration, IDisposable, IMarker, Terminal } from '@xterm/xterm'
import { crumb } from './diag'
import { rowsToReink } from './linkInkRows'
import { sliceRows, type RowPlan } from './linkScanPlan'
import { findLinks } from './termLinks'
import { cellText } from './termCells'
import {
  bufferRowCells,
  piecesOverlap,
  spanRows,
  spanText,
  spanTextRange,
  type Osc8Span,
  type RowPiece
} from './termOsc8'

/**
 * Paints the links in a terminal's buffer (owner, 2026-09-19). xterm's link
 * addon only underlines a link while the pointer is on it, so a printed URL
 * looked like any other text. A DECORATION is what colours cells that are
 * already in the buffer: one per row a link sits on, carrying the link colour
 * as its foreground and a faint underline as its element.
 *
 * WHAT IS SCANNED, and it is the whole design. Scrollback is immutable: a line
 * that has left the live screen never changes again, so its links are painted
 * once and kept (a marker rides each one, and xterm disposes it when the line
 * is trimmed). The LIVE screen is not: a TUI redraws its rows in place, and a
 * decoration left on a row whose text has changed is a blue smear over words
 * that were never a link. So every pass throws away what it painted from the
 * last finished line down and paints that part again. A marker remembers where
 * "finished" was, which survives the buffer scrolling and trimming under it.
 *
 * NO PASS HOLDS THE PAGE (#167). A full pass (a resize, a theme, a buffer
 * switch) paints the live screen at once and the scrollback after it, bottom
 * up, in slices of SLICE_MS (`linkScanPlan.ts`); a found path repaints only
 * the lines that asked about it (`revisit`). Before, both walked all 10,000
 * lines of scrollback in one task, in every tab: 2 s window stalls, MEASURED.
 *
 * THE ALTERNATE SCREEN IS INKED AS IT IS DRAWN (owner, 2026-09-28: a link in
 * Claude Code's fullscreen view "is not blue ... it seems to know it's a link
 * since i can click it"). Markers do not exist there, so neither do
 * decorations. Instead, each time xterm draws rows there (`onRender`), the
 * link text in those rows' elements is wrapped in a span of the link colour.
 * xterm's DOM renderer REPLACES a row's contents when it draws it, so a row a
 * TUI rewrites starts clean and is inked again only if it still holds a link:
 * no smear to clean up. Per row: a program that owns the screen places its own
 * text, and a link it breaks over two rows is two pieces of text there.
 *
 * OSC 8 LINKS ARE PAINTED FROM THE STREAM (#169): the panel notes where each
 * one was printed (`termOsc8.ts`) and hands them over as `opts.spans`; both
 * screens paint them like any link, while their cells hold the same text.
 */
export interface LinkPainter extends IDisposable {
  /** The colour changed (a theme, a custom ground): paint everything again. */
  repaint(): void
  /** A path this terminal asked about exists (#167): paint again only the
   *  lines that were waiting for the answer, never the whole buffer. */
  revisit(): void
}

export interface LinkPaintOptions {
  /** Whether the `find` call just made left a question open (a path not yet
   *  known): that line is remembered and painted again by `revisit`. */
  asked?: () => boolean
  /** The OSC 8 links (#169) with a cell on buffer lines `first` to `last` of
   *  the screen in front. Their labels ("PR #165") are neither URLs nor paths,
   *  so `find` never sees them; each is painted while its cells still hold
   *  the text it was printed with. */
  spans?: (first: number, last: number) => Osc8Span[]
}

interface Painted {
  marker: IMarker
  deco: IDecoration
}

/** One character of a logical line, and the cell it sits in. */
interface Cell {
  row: number
  x: number
  w: number
}

const DEBOUNCE_MS = 80
/** The longest one slice of the scrollback backlog may hold the page (#167). */
const SLICE_MS = 8
/** A pass slower than this leaves a crumb in the diag log, so the next stall
 *  report says whether the painter was in it. */
const SLOW_PASS_MS = 50
/** Lines remembered as waiting for a path's answer; the oldest go first. */
const WAITING_CAP = 500

export function attachLinkPaint(
  term: Terminal,
  color: () => string,
  /** What wears the link colour in a line of text: the web links, and the
   *  host panel adds the paths that exist (#99). */
  find: (text: string) => Array<{ start: number; end: number }> = findLinks,
  opts: LinkPaintOptions = {}
): LinkPainter {
  let painted: Painted[] = []
  /** Everything above this line is scrollback that has been painted, or is
   *  still in the backlog below. */
  let finished: IMarker | undefined
  let timer: number | undefined
  let dead = false
  /** The first row of each painted line whose `find` left a question open. */
  let waiting: IMarker[] = []
  /** The scrollback a full pass still has to paint, bottom up (#167). */
  let backlog: { plan: RowPlan; cursor: IMarker; timer?: number } | undefined

  const markerAt = (line: number): IMarker | undefined => {
    const b = term.buffer.active
    return term.registerMarker(line - (b.baseY + b.cursorY))
  }

  const rowCells = (line: number): ReturnType<typeof bufferRowCells> =>
    bufferRowCells(term.buffer.active.getLine(line), term.cols)

  /** An OSC 8 link stands while its cells hold what was printed there: a
   *  TUI that writes something else over them took the link away. */
  const standing = (s: Osc8Span): boolean => spanText(s, term.cols, rowCells) === s.text

  /** Drop what was painted on lines `first` to `last` (and anything trimmed). */
  const forgetLines = (first: number, last: number): void => {
    const keep = (m: IMarker): boolean => !m.isDisposed && (m.line < first || m.line > last)
    painted = painted.filter((p) => {
      if (keep(p.marker)) return true
      p.deco.dispose()
      p.marker.dispose()
      return false
    })
    waiting = waiting.filter((m) => {
      if (keep(m)) return true
      m.dispose()
      return false
    })
  }

  const forgetFrom = (line: number): void => forgetLines(line, Number.MAX_SAFE_INTEGER)

  const noteWaiting = (line: number): void => {
    const m = markerAt(line)
    if (!m) return
    waiting.push(m)
    if (waiting.length > WAITING_CAP) waiting.shift()?.dispose()
  }

  const paintRow = (row: number, x: number, width: number, ink: string): void => {
    const b = term.buffer.active
    const marker = term.registerMarker(row - (b.baseY + b.cursorY))
    if (!marker) return
    const deco = term.registerDecoration({ marker, x, width, foregroundColor: ink, layer: 'bottom' })
    if (!deco) {
      marker.dispose()
      return
    }
    // The colour says "link"; the underline says it on a theme where the link
    // colour had to move close to the text's. Never in the way of a click.
    deco.onRender((el) => {
      el.style.pointerEvents = 'none'
      el.style.boxSizing = 'border-box'
      el.style.borderBottom = `1px solid ${ink}8c`
    })
    painted.push({ marker, deco })
  }

  /** A logical line: the row it starts on and every wrapped row after it. */
  const paintLogical = (first: number, last: number, ink: string): void => {
    const b = term.buffer.active
    const rows: IBufferLine[] = []
    let quick = ''
    for (let r = first; r <= last; r += 1) {
      const line = b.getLine(r)
      if (!line) return
      rows.push(line)
      quick += line.translateToString(r === last)
    }
    // OSC 8 links first: their labels need not look like links at all.
    const taken: RowPiece[] = []
    for (const s of opts.spans?.(first, last) ?? []) {
      if (!standing(s)) continue
      for (const p of spanRows(s, term.cols))
        if (p.line >= first && p.line <= last) {
          paintRow(p.line, p.x, p.width, ink)
          taken.push(p)
        }
    }
    if (!/[\\/.]/.test(quick)) return // no URL and no path can be here
    // Built cell by cell, because a wide character is one character and TWO
    // cells: an index into the string is not a column once a line holds one.
    let text = ''
    const cells: Cell[] = []
    rows.forEach((line, i) => {
      for (let x = 0; x < line.length; x += 1) {
        const cell = line.getCell(x)
        if (!cell) continue
        const w = cell.getWidth()
        if (w === 0) continue // the second half of a wide character
        const chars = cell.getChars() || ' '
        text += chars
        for (let k = 0; k < chars.length; k += 1) cells.push({ row: first + i, x, w })
      }
    })
    const links = find(text)
    if (opts.asked?.()) noteWaiting(first)
    for (const link of links) {
      const pieces: RowPiece[] = []
      let from = link.start
      while (from < link.end) {
        const row = cells[from].row
        let to = from
        while (to + 1 < link.end && cells[to + 1].row === row) to += 1
        pieces.push({ line: row, x: cells[from].x, width: cells[to].x + cells[to].w - cells[from].x })
        from = to + 1
      }
      // An OSC 8 label that is itself a URL is painted once, as the span: two
      // coats of the same ink and two underlines otherwise.
      if (piecesOverlap(pieces, taken)) continue
      for (const p of pieces) paintRow(p.line, p.x, p.width, ink)
    }
  }

  /**
   * Where the OSC 8 links on screen row `r` sit in that row's drawn text.
   * Columns become text offsets cell by cell (rule 11), and a piece is kept
   * only where the drawn text there is the cells' text, so a row xterm drew
   * differently is left alone rather than inked in the wrong place.
   */
  const spanRanges = (r: number, text: string): Array<{ start: number; end: number }> => {
    const line = term.buffer.active.viewportY + r
    const spans = opts.spans?.(line, line) ?? []
    if (!spans.length) return []
    const cells = rowCells(line)
    if (!cells) return []
    const own = cellText(cells).text
    const out: Array<{ start: number; end: number }> = []
    for (const s of spans) {
      if (!standing(s)) continue
      for (const p of spanRows(s, term.cols)) {
        if (p.line !== line) continue
        const { start, end } = spanTextRange(cells, p.x, p.x + p.width)
        if (end > start && text.slice(start, end) === own.slice(start, end)) out.push({ start, end })
      }
    }
    return out
  }

  /** Ink the links in one drawn row (screen row `r`) of the alternate screen.
   *  True when the row now holds ink. */
  const inkRow = (row: Element, ink: string, r: number): boolean => {
    const text = row.textContent ?? ''
    const found = /[\\/.]/.test(text) ? find(text) : []
    // An OSC 8 label that is itself a URL is inked once, as the URL.
    const spans = spanRanges(r, text).filter((s) => !found.some((l) => l.start < s.end && s.start < l.end))
    // In order along the row: the pieces are wrapped last first, below.
    const links = [...found, ...spans].sort((a, b) => a.start - b.start)
    if (!links.length) return false
    // Where each text node starts in the row's text.
    const nodes: Array<{ node: Text; at: number }> = []
    const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    let at = 0
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      nodes.push({ node: n as Text, at })
      at += n.textContent?.length ?? 0
    }
    const pieces: Array<{ node: Text; from: number; to: number }> = []
    for (const link of links)
      for (const { node, at: start } of nodes) {
        const from = Math.max(link.start, start)
        const to = Math.min(link.end, start + (node.textContent?.length ?? 0))
        if (from < to) pieces.push({ node, from: from - start, to: to - start })
      }
    // Last first: wrapping splits a text node, and the part BEFORE the split
    // stays the node the earlier pieces point into.
    for (const { node, from, to } of pieces.reverse()) {
      const range = document.createRange()
      range.setStart(node, from)
      range.setEnd(node, to)
      const span = document.createElement('span')
      span.dataset.linkInk = ''
      span.style.color = ink
      span.style.textDecoration = 'underline'
      span.style.textDecorationColor = `${ink}8c`
      range.surroundContents(span)
    }
    return pieces.length > 0
  }

  /** Watches the rows for redraws that fire no `onRender` (below). */
  let watch: MutationObserver | undefined
  /** The row elements that held ink when last drawn or inked. xterm keeps a
   *  row's element and replaces its contents, so the element is the key. */
  let inked = new WeakSet<Element>()

  const inkAndRemember = (row: Element, ink: string, r: number): void => {
    if (inkRow(row, ink, r)) inked.add(row)
    else inked.delete(row)
  }

  const inkDrawn = (start: number, end: number): void => {
    if (dead || term.buffer.active.type !== 'alternate') return
    const box = term.element?.querySelector('.xterm-rows')
    if (!box) return
    watchRows(box)
    const rows = box.children
    const ink = color()
    for (let r = start; r <= end; r += 1) {
      const row = rows[r]
      if (row) inkAndRemember(row, ink, r)
    }
  }

  // A HOVER REDRAWS A ROW BEHIND onRender's BACK (#163; owner's recording,
  // 2026-10-10: a hovered link in Claude Code's fullscreen view turned white
  // and stayed white until a scroll). xterm's DOM renderer underlines a hovered
  // link, and takes the underline off again, by REPLACING the row's contents
  // (`_setCellUnderline`), and that fires no onRender. So a row that held ink
  // and lost it is inked again here; a row onRender just drew is not scanned
  // twice (`rowsToReink`). Watched on the alternate screen only: the normal
  // screen is painted with decorations, and the watch would fire every frame.
  const watchRows = (box: Element): void => {
    if (watch) return
    watch = new MutationObserver((records) => {
      if (dead || term.buffer.active.type !== 'alternate') return
      const seen = new Set<Element>()
      for (const rec of records) {
        let row: Node | null = rec.target
        while (row && row.parentNode !== box) row = row.parentNode
        if (row instanceof Element) seen.add(row)
      }
      const lost = rowsToReink(
        seen,
        (row) => inked.has(row),
        (row) => row.querySelector('[data-link-ink]') !== null
      )
      if (!lost.length) return
      const ink = color()
      const all = Array.from(box.children)
      for (const row of lost) inkAndRemember(row, ink, all.indexOf(row))
    })
    watch.observe(box, { childList: true, subtree: true })
  }

  /** The last row of the logical line that starts on `first`. */
  const lastRowOf = (first: number, end: number): number => {
    const b = term.buffer.active
    let last = first
    while (last + 1 <= end && b.getLine(last + 1)?.isWrapped) last += 1
    return last
  }

  const slow = (where: string, t0: number, lines: number): void => {
    const ms = Math.round(performance.now() - t0)
    if (ms > SLOW_PASS_MS) crumb('link-paint', { where, ms, lines })
  }

  const cancelBacklog = (): void => {
    if (!backlog) return
    backlog.plan.cancel()
    if (backlog.timer !== undefined) window.clearTimeout(backlog.timer)
    backlog.cursor.dispose()
    backlog = undefined
  }

  /**
   * One slice of the backlog: lines from the cursor UP, until SLICE_MS is
   * spent, then the page gets the thread back. The cursor is a marker, so the
   * buffer trimming lines off its top moves it too; once it is trimmed itself,
   * everything above it is gone and the backlog has nothing left to paint.
   */
  const backlogStep = (): void => {
    const bl = backlog
    if (!bl) return
    bl.timer = undefined
    const b = term.buffer.active
    if (dead || b.type !== 'normal' || bl.cursor.isDisposed) return cancelBacklog()
    const t0 = performance.now()
    const ink = color()
    // Painted INSIDE the walk, so the slice's clock counts the painting.
    const rows = bl.plan.next((r) => {
      // A wrapped row is painted with the line it continues, from that line's
      // first row, which the walk reaches next. The backlog stops above the
      // live pass's first line, so no line here runs into painted rows.
      if (!b.getLine(r)?.isWrapped) paintLogical(r, lastRowOf(r, b.length - 1), ink)
    }, bl.cursor.line)
    if (!rows) return cancelBacklog()
    slow('backlog', t0, rows.length)
    const next = rows[rows.length - 1] - 1
    bl.cursor.dispose()
    const cursor = next >= 0 ? markerAt(next) : undefined
    if (!cursor) {
      backlog = undefined
      return
    }
    bl.cursor = cursor
    bl.timer = window.setTimeout(backlogStep, 0)
  }

  /** Paint lines `top` and up, after the live screen, a slice at a time. */
  const startBacklog = (top: number): void => {
    cancelBacklog()
    if (top < 0) return
    const cursor = markerAt(top)
    if (!cursor) return
    backlog = { plan: sliceRows(0, top, SLICE_MS, () => performance.now()), cursor }
    backlog.timer = window.setTimeout(backlogStep, 0)
  }

  const unwatchRows = (): void => {
    watch?.disconnect()
    watch = undefined
    inked = new WeakSet()
  }

  const scan = (): void => {
    timer = undefined
    if (dead) return
    const b = term.buffer.active
    if (b.type !== 'normal') return
    const live = b.baseY
    // A FULL pass (nothing painted yet, a start over, or the marker trimmed
    // away under a flood of output) paints the live screen now and leaves the
    // scrollback to the backlog. It used to paint all 10,000 lines here in
    // one task: MEASURED 2009 ms and 2046 ms (#167).
    const done = finished && !finished.isDisposed && finished.line >= 0 ? finished.line : -1
    const full = done < 0
    let start = full ? live : Math.min(done, live)
    // A pass starts on a whole logical line.
    while (start > 0 && b.getLine(start)?.isWrapped) start -= 1
    const end = Math.min(b.length - 1, live + term.rows - 1)
    if (full) cancelBacklog()
    forgetFrom(full ? 0 : start)
    const t0 = performance.now()
    const ink = color()
    let first = start
    while (first <= end) {
      const last = lastRowOf(first, end)
      paintLogical(first, last, ink)
      first = last + 1
    }
    slow('live', t0, end - start + 1)
    finished?.dispose()
    finished = markerAt(live)
    if (full) startBacklog(start - 1)
  }

  const soon = (): void => {
    if (timer === undefined && !dead) timer = window.setTimeout(scan, DEBOUNCE_MS)
  }

  const startOver = (): void => {
    cancelBacklog()
    forgetFrom(0)
    finished?.dispose()
    finished = undefined
    soon()
    // The alternate screen is inked as it is drawn: draw it all again.
    if (term.buffer.active.type === 'alternate') term.refresh(0, term.rows - 1)
  }

  /**
   * A path this terminal asked about exists (#167). Each scrollback line that
   * was waiting is forgotten and painted again on its own; the live screen is
   * left to the next ordinary pass, which repaints it anyway. It used to be a
   * start over: every tab, every line.
   */
  const revisit = (): void => {
    if (dead) return
    const b = term.buffer.active
    if (b.type === 'alternate') {
      // No markers here: redraw only the rows that hold something to ink, and
      // xterm's onRender inks them.
      const rows = term.element?.querySelector('.xterm-rows')?.children
      if (!rows) return
      let lo = -1
      let hi = -1
      for (let r = 0; r < rows.length; r += 1) {
        const text = rows[r].textContent ?? ''
        if (!/[\\/.]/.test(text) || !find(text).length) continue
        if (lo < 0) lo = r
        hi = r
      }
      if (lo >= 0) term.refresh(lo, hi)
      return
    }
    const top = finished && !finished.isDisposed ? finished.line : -1
    const t0 = performance.now()
    const ink = color()
    const again = waiting.filter((m) => !m.isDisposed && m.line < top).map((m) => m.line)
    for (const first of again) {
      const last = lastRowOf(first, b.length - 1)
      forgetLines(first, last)
      paintLogical(first, last, ink)
    }
    slow('revisit', t0, again.length)
    soon()
  }

  const subs: IDisposable[] = [
    term.onWriteParsed(soon),
    // A resize reflows every wrapped line: nothing painted is where it was.
    term.onResize(startOver),
    // Into the alternate screen and back out of it. The row watch goes with
    // the alternate screen; its first onRender there attaches it again.
    term.buffer.onBufferChange((b) => {
      if (b.type !== 'alternate') unwatchRows()
      startOver()
    }),
    term.onRender(({ start, end }) => inkDrawn(start, end))
  ]

  return {
    repaint: startOver,
    revisit,
    dispose: () => {
      dead = true
      unwatchRows()
      if (timer !== undefined) window.clearTimeout(timer)
      cancelBacklog()
      subs.forEach((s) => s.dispose())
      forgetFrom(0)
      finished?.dispose()
    }
  }
}
