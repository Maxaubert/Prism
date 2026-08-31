import { useEffect, useRef, useState, type JSX, type RefObject } from 'react'
import { matchRanges, stepMatch } from '../lib/findInText'

/**
 * Ctrl+F for the documents that had none: markdown, docx, odt, pptx, xlsx,
 * rtf, epub (2026-08-30).
 *
 * Highlighting goes through the CSS Custom Highlight API rather than by
 * wrapping matches in <mark>, and that is not a stylistic preference: the
 * office and ebook viewers render HTML that main SANITISED before handing it
 * over, and the markdown view is React's. Injecting elements into either
 * would fight the renderer that owns those nodes and would have to be undone
 * exactly. A Highlight paints ranges and touches nothing.
 *
 * The bar itself is the PDF viewer's shape, so the two do not read as two
 * different applications.
 */

/**
 * Highlight names are per INSTANCE (2026-08-30).
 *
 * `CSS.highlights` is one registry for the whole document, so two find bars -
 * split view mounts up to four viewers - wrote to the same two names and each
 * repaint wiped the other's ranges. The stylesheet matches the prefix, so a
 * new instance needs no new CSS.
 */
const SLOTS = 8
const taken = new Set<number>()

/** The lowest free slot, so the numbers stay small and the CSS stays finite. */
function claimSlot(): number {
  for (let i = 1; i <= SLOTS; i += 1) if (!taken.has(i)) {
    taken.add(i)
    return i
  }
  return 1 // more find bars than panes can exist: share, rather than go unstyled
}

interface TextBit {
  node: Text
  start: number
}

/** Every text node under `root`, with where each begins in the flat text. */
function collect(root: HTMLElement): { text: string; bits: TextBit[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const bits: TextBit[] = []
  let text = ''
  let n = walker.nextNode()
  while (n) {
    const t = n as Text
    // Skip what is not really content: a script's body is not page text, and
    // the find bar's own input must never find itself.
    const parent = t.parentElement
    if (parent && !parent.closest('[data-find-bar]') && parent.offsetParent !== null) {
      bits.push({ node: t, start: text.length })
      text += t.data
    }
    n = walker.nextNode()
  }
  return { text, bits }
}

/** Turn a flat offset range back into a DOM Range across text nodes. */
function toRange(bits: TextBit[], start: number, end: number): Range | null {
  let a: { node: Text; offset: number } | null = null
  let b: { node: Text; offset: number } | null = null
  for (const bit of bits) {
    const bitEnd = bit.start + bit.node.data.length
    if (!a && start >= bit.start && start < bitEnd) a = { node: bit.node, offset: start - bit.start }
    if (end > bit.start && end <= bitEnd) {
      b = { node: bit.node, offset: end - bit.start }
      break
    }
  }
  if (!a || !b) return null
  const r = document.createRange()
  r.setStart(a.node, a.offset)
  r.setEnd(b.node, b.offset)
  return r
}

export function DocFind({
  scroller,
  onClose
}: {
  /** The element whose text is searched, and which is scrolled to a hit. */
  scroller: RefObject<HTMLElement | null>
  onClose: () => void
}): JSX.Element {
  const [slot] = useState(claimSlot)
  const hl = { all: `prism-find-${slot}`, current: `prism-find-current-${slot}` }
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  // State rather than a ref: the paint effect has to re-run when they change,
  // and a ref written from a handler would not tell it to.
  const [ranges, setRanges] = useState<Range[]>([])
  const count = ranges.length

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  /**
   * Escape closes it from anywhere (2026-08-30).
   *
   * The bar carries `data-owns-escape`, which is App's signal to yield the
   * key - so while it is up, an Escape that this component does not handle is
   * an Escape that does NOTHING. Handling it only inside the input meant that
   * clicking into the document to read a hit left Escape dead: the bar would
   * not close, the document would not blur and fullscreen would not exit.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  /** Walk the text once per query; stepping then costs nothing. Not memoized:
   *  it is called from one change handler, and the DOM ranges it builds are
   *  not values the compiler can reason about. */
  function run(q: string): void {
    const root = scroller.current
    if (!root || !q) {
      setRanges([])
      setAt(-1)
      return
    }
    const { text, bits } = collect(root)
    const rs: Range[] = []
    for (const m of matchRanges(text, q)) {
      const r = toRange(bits, m.start, m.end)
      if (r) rs.push(r)
    }
    setRanges(rs)
    setAt(rs.length ? 0 : -1)
  }

  // Repaint whenever the query or the current match changes. Two highlights:
  // every hit in one colour, the one you are on in the accent, so stepping is
  // visible without scrolling being the only feedback.
  useEffect(() => {
    const highlights = (CSS as unknown as { highlights?: Map<string, Highlight> }).highlights
    const Ctor = (window as unknown as { Highlight?: new (...r: Range[]) => Highlight }).Highlight
    if (!highlights || !Ctor) return
    const rs = ranges
    highlights.delete(hl.all)
    highlights.delete(hl.current)
    if (!rs.length) return
    const others = rs.filter((_, i) => i !== at)
    if (others.length) highlights.set(hl.all, new Ctor(...others))
    if (at >= 0 && rs[at]) {
      highlights.set(hl.current, new Ctor(rs[at]))
      // block: 'center' rather than 'nearest': a hit that lands one line under
      // the top edge of the window is a hit you have to hunt for.
      const el = rs[at].startContainer.parentElement
      el?.scrollIntoView({ block: 'center', behavior: 'auto' })
    }
  }, [at, ranges, hl])

  // Everything the highlight owns goes when the bar does, slot included.
  useEffect(() => {
    return () => {
      taken.delete(slot)
      const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
      highlights?.delete(hl.all)
      highlights?.delete(hl.current)
    }
    // hl is derived from slot, which never changes for this instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot])

  const step = (delta: number): void => setAt((i) => stepMatch(ranges.length, i, delta))

  return (
    <div
      data-find-bar
      data-owns-escape
      className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-[var(--p-radius-sm)] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-2 py-1 shadow-[0_10px_28px_rgba(0,0,0,.45)]"
    >
      <input
        ref={input}
        value={query}
        spellCheck={false}
        placeholder="Find"
        aria-label="Find in document"
        className="w-[180px] bg-transparent text-[12px] text-[var(--p-text)] outline-none placeholder:text-[var(--p-dim2)]"
        onChange={(e) => {
          setQuery(e.target.value)
          run(e.target.value)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          else if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
        }}
      />
      <span className="min-w-[52px] shrink-0 text-right text-[11px] tabular-nums text-[var(--p-dim2)]">
        {query ? (count ? `${at + 1} of ${count}` : 'none') : ''}
      </span>
      <button
        aria-label="Previous match"
        disabled={!count}
        className="grid h-5 w-5 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] disabled:opacity-40"
        onClick={() => step(-1)}
      >
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>
      <button
        aria-label="Next match"
        disabled={!count}
        className="grid h-5 w-5 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] disabled:opacity-40"
        onClick={() => step(1)}
      >
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <button
        aria-label="Close find"
        className="grid h-5 w-5 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
        onClick={onClose}
      >
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
