// Text search over a PDF's extracted text. Pure: the viewer feeds it one string
// per text-layer node and maps the resulting item spans back onto the DOM (the
// CSS Custom Highlight API draws them). Matching is a case-folded substring,
// which is what a viewer's Ctrl+F means; it may span items (pdf.js splits
// sentences freely) but never a page boundary.

export interface PageText {
  /** One string per text-layer node, in layer order. */
  items: string[]
}

export interface MatchPart {
  item: number
  start: number
  end: number
}

export interface Match {
  page: number
  /** First touched item and its offsets, for scrolling to the match. */
  item: number
  start: number
  end: number
  /** Every touched item, in order; one entry when the match sits inside one. */
  parts: MatchPart[]
}

export function findMatches(pages: PageText[], query: string): Match[] {
  const q = query.toLowerCase()
  if (!q.trim()) return []
  const out: Match[] = []

  pages.forEach(({ items }, page) => {
    // The page's text as one string, with each item's global start offset, so a
    // plain indexOf can find matches that straddle item boundaries.
    const starts: number[] = []
    let full = ''
    for (const it of items) {
      starts.push(full.length)
      full += it
    }
    const hay = full.toLowerCase()

    let at = hay.indexOf(q)
    while (at !== -1) {
      const end = at + q.length
      const parts: MatchPart[] = []
      for (let i = 0; i < items.length; i += 1) {
        const s = starts[i]
        const e = s + items[i].length
        if (e <= at || s >= end || s === e) continue
        parts.push({ item: i, start: Math.max(at, s) - s, end: Math.min(end, e) - s })
      }
      if (parts.length) {
        out.push({ page, item: parts[0].item, start: parts[0].start, end: parts[0].end, parts })
      }
      at = hay.indexOf(q, at + 1)
    }
  })
  return out
}

/** The next match index from `current`, stepping by `delta` and wrapping. */
export function stepMatch(current: number, delta: number, total: number): number {
  if (total <= 0) return -1
  return (((current + delta) % total) + total) % total
}
