import { contrastRatio, ensureContrast, mixHex, normalizeColor } from './termAnsi'

/**
 * Links in the terminal: which text is one, and what colour it wears
 * (owner, 2026-09-19: a printed URL should be highlighted, not only underlined
 * while the pointer is on it). Pure, so both halves can be tested without a
 * terminal; lib/termLinkPaint is what paints them.
 */

/** The link blue. It is what a link is on the dark grounds most themes have,
 *  and the starting point on every other. A calm blue, not a vivid one
 *  (owner, 2026-09-28: "make the link colours less blue ... too saturated"):
 *  #4ea1ff at half its saturation, the same hue and lightness. */
export const LINK_BLUE = '#79a7d8'

/** Readable as TEXT, not merely visible: a link is something you read. */
const FLOOR = 4.5

/**
 * The colour a link wears on this ground.
 *
 * Blue, moved only as far as it has to be. On a light ground, or a ground that
 * is itself blue (where a blue link is exactly the thing that gets hard to
 * see), it is walked toward whichever end has room until it reads, which keeps
 * it a blue for as long as a blue can clear the floor. If that walk lands on
 * the text's own colour, a link would be told from the words around it by its
 * underline alone, so it is pulled a step back toward blue when the floor
 * allows.
 */
export function linkColor(background: string, foreground: string): string {
  const bg = normalizeColor(background, '#000000')
  const fg = normalizeColor(foreground, '#ffffff')
  const moved = ensureContrast(LINK_BLUE, bg, FLOOR)
  if (moved === LINK_BLUE || contrastRatio(moved, fg) >= 1.25) return moved
  const tinted = mixHex(moved, LINK_BLUE, 0.35)
  return contrastRatio(tinted, bg) >= FLOOR ? tinted : moved
}

export interface LinkSpan {
  /** Index of the link's first character in the text. */
  start: number
  /** One past its last. */
  end: number
}

const CANDIDATE = /https?:\/\/[^\s"'<>`]+/gi
/** What ends a sentence, not a link. */
const TRAILING = /[.,;:!?]$/
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/**
 * The http(s) links in a line of text. A link runs to the next space, quote or
 * angle bracket; then whatever belongs to the SENTENCE is given back: a full
 * stop or comma after it, and a closing bracket the link never opened, so
 * "(https://a.io/x)." is a link in brackets while ".../Prism_(optics)" keeps
 * its own.
 */
export function findLinks(text: string): LinkSpan[] {
  const out: LinkSpan[] = []
  for (const m of text.matchAll(CANDIDATE)) {
    let url = m[0]
    for (;;) {
      const last = url[url.length - 1]
      if (TRAILING.test(url)) url = url.slice(0, -1)
      else if (last in CLOSERS && count(url, last) > count(url, CLOSERS[last])) url = url.slice(0, -1)
      else break
    }
    // A scheme with nothing after it is not a link.
    if (!/^https?:\/\/[^/?#]/i.test(url)) continue
    const start = m.index ?? 0
    out.push({ start, end: start + url.length })
  }
  return out
}

function count(s: string, ch: string): number {
  let n = 0
  for (const c of s) if (c === ch) n += 1
  return n
}
