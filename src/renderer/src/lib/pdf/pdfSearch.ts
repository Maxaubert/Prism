// Text search over a PDF's extracted text. Pure: the viewer feeds it one string
// per text-layer node and maps the resulting item spans back onto the DOM (the
// CSS Custom Highlight API draws them). Matching is a case-folded substring,
// which is what a viewer's Ctrl+F means; it may span items (pdf.js splits
// sentences freely) but never a page boundary.

import { foldCase } from '../findInText'

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
    // Lower-casing can lengthen the text, so keep a map back to 'full'.
    const { folded: hay, starts: fs, ends: fe } = foldCase(full)

    let at = hay.indexOf(q)
    while (at !== -1) {
      const from = fs[at]
      const end = fe[at + q.length - 1]
      const next = at + 1
      const parts: MatchPart[] = []
      for (let i = 0; i < items.length; i += 1) {
        const s = starts[i]
        const e = s + items[i].length
        if (e <= from || s >= end || s === e) continue
        parts.push({ item: i, start: Math.max(from, s) - s, end: Math.min(end, e) - s })
      }
      if (parts.length) {
        out.push({ page, item: parts[0].item, start: parts[0].start, end: parts[0].end, parts })
      }
      at = hay.indexOf(q, next)
    }
  })
  return out
}

/** The next match index from `current`, stepping by `delta` and wrapping. */
export function stepMatch(current: number, delta: number, total: number): number {
  if (total <= 0) return -1
  return (((current + delta) % total) + total) % total
}

/** The part of a pdf.js document the finder and the size prefetch read. */
export interface PageSource {
  getPage(n: number): Promise<{
    getTextContent(): Promise<{ items: ReadonlyArray<object> }>
    getViewport(o: { scale: number }): { width: number; height: number }
  }>
}

/**
 * One page's text, cached by page. A page that cannot be read (a broken page
 * object in a truncated file) counts as an empty page and is NOT cached, so it
 * cannot sink every later search with the same rejection (audit #86).
 */
export function cachedPageText(
  cache: Map<number, Promise<PageText>>,
  doc: PageSource,
  n: number
): Promise<PageText> {
  let p = cache.get(n)
  if (!p) {
    p = doc
      .getPage(n)
      .then((pg) => pg.getTextContent())
      .then((tc) => ({
        items: tc.items.map((i) => ('str' in i && typeof i.str === 'string' ? i.str : ''))
      }))
      .catch(() => {
        cache.delete(n)
        return { items: [] }
      })
    cache.set(n, p)
  }
  return p
}

/** A page's size at scale 1, or null when the page cannot be read (audit #87). */
export async function pageSize(
  doc: PageSource,
  n: number
): Promise<{ w: number; h: number } | null> {
  try {
    const vp = (await doc.getPage(n)).getViewport({ scale: 1 })
    return { w: vp.width, h: vp.height }
  } catch {
    return null
  }
}
