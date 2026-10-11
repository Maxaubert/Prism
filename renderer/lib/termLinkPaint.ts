import type { IBufferLine, IDecoration, IDisposable, IMarker, Terminal } from '@xterm/xterm'
import { rowsToReink } from './linkInkRows'
import { findLinks } from './termLinks'

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
 * THE ALTERNATE SCREEN IS INKED AS IT IS DRAWN (owner, 2026-09-28: a link in
 * Claude Code's fullscreen view "is not blue ... it seems to know it's a link
 * since i can click it"). Markers do not exist there, so neither do
 * decorations. Instead, each time xterm draws rows there (`onRender`), the
 * link text in those rows' elements is wrapped in a span of the link colour.
 * xterm's DOM renderer REPLACES a row's contents when it draws it, so a row a
 * TUI rewrites starts clean and is inked again only if it still holds a link:
 * no smear to clean up. Per row: a program that owns the screen places its own
 * text, and a link it breaks over two rows is two pieces of text there.
 */
export interface LinkPainter extends IDisposable {
  /** The colour changed (a theme, a custom ground): paint everything again. */
  repaint(): void
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

export function attachLinkPaint(
  term: Terminal,
  color: () => string,
  /** What wears the link colour in a line of text: the web links, and the
   *  host panel adds the paths that exist (#99). */
  find: (text: string) => Array<{ start: number; end: number }> = findLinks
): LinkPainter {
  let painted: Painted[] = []
  /** Everything above this line is scrollback that has been painted. */
  let finished: IMarker | undefined
  let timer: number | undefined
  let dead = false

  const forgetFrom = (line: number): void => {
    painted = painted.filter((p) => {
      const at = p.marker.isDisposed ? -1 : p.marker.line
      if (at >= 0 && at < line) return true
      p.deco.dispose()
      p.marker.dispose()
      return false
    })
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
    for (const link of find(text)) {
      let from = link.start
      while (from < link.end) {
        const row = cells[from].row
        let to = from
        while (to + 1 < link.end && cells[to + 1].row === row) to += 1
        paintRow(row, cells[from].x, cells[to].x + cells[to].w - cells[from].x, ink)
        from = to + 1
      }
    }
  }

  /** Ink the links in one drawn row of the alternate screen. True when the
   *  row now holds ink. */
  const inkRow = (row: Element, ink: string): boolean => {
    const text = row.textContent ?? ''
    if (!/[\\/.]/.test(text)) return false
    const links = find(text)
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

  const inkAndRemember = (row: Element, ink: string): void => {
    if (inkRow(row, ink)) inked.add(row)
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
      if (row) inkAndRemember(row, ink)
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
      for (const row of lost) inkAndRemember(row, ink)
    })
    watch.observe(box, { childList: true, subtree: true })
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
    let start = finished && !finished.isDisposed && finished.line >= 0 ? Math.min(finished.line, live) : 0
    // A pass starts on a whole logical line.
    while (start > 0 && b.getLine(start)?.isWrapped) start -= 1
    const end = Math.min(b.length - 1, live + term.rows - 1)
    forgetFrom(start)
    const ink = color()
    let first = start
    while (first <= end) {
      let last = first
      while (last + 1 <= end && b.getLine(last + 1)?.isWrapped) last += 1
      paintLogical(first, last, ink)
      first = last + 1
    }
    finished?.dispose()
    finished = term.registerMarker(live - (b.baseY + b.cursorY))
  }

  const soon = (): void => {
    if (timer === undefined && !dead) timer = window.setTimeout(scan, DEBOUNCE_MS)
  }

  const startOver = (): void => {
    forgetFrom(0)
    finished?.dispose()
    finished = undefined
    soon()
    // The alternate screen is inked as it is drawn: draw it all again.
    if (term.buffer.active.type === 'alternate') term.refresh(0, term.rows - 1)
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
    dispose: () => {
      dead = true
      unwatchRows()
      if (timer !== undefined) window.clearTimeout(timer)
      subs.forEach((s) => s.dispose())
      forgetFrom(0)
      finished?.dispose()
    }
  }
}
