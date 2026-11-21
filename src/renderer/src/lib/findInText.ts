/**
 * Finding a string in a document's text.
 *
 * Ctrl+F did nothing on a README or a 300-page epub while a polished find bar
 * sat one file type away in the PDF viewer (2026-08-30). This is the part of
 * the answer that has no DOM in it: given the document's text, where are the
 * matches. The component that owns highlighting maps these offsets back onto
 * the text nodes they came from.
 *
 * Deliberately a plain case-insensitive substring, not the sidebar's operator
 * language. That parser answers "which FILES", where several words in any
 * order is what people mean; this answers "where on this page", where they
 * mean the letters they typed, in that order.
 */

export interface Match {
  start: number
  end: number
}

/**
 * The text lower-cased, with a map back to the original. Lower-casing can change
 * the length (U+0130 becomes two units), so an index into `folded` is not an
 * index into the text. `starts[k]` is where the character behind folded unit k
 * begins in the original, `ends[k]` where it ends.
 */
export interface Folded {
  folded: string
  starts: number[]
  ends: number[]
}

export function foldCase(text: string): Folded {
  let folded = ''
  const starts: number[] = []
  const ends: number[] = []
  let i = 0
  for (const ch of text) {
    const lower = ch.toLowerCase()
    const next = i + ch.length
    for (let k = 0; k < lower.length; k += 1) {
      starts.push(i)
      ends.push(next)
    }
    folded += lower
    i = next
  }
  return { folded, starts, ends }
}

/** Every occurrence of `query` in `text`, case-insensitively. */
export function matchRanges(text: string, query: string): Match[] {
  const out: Match[] = []
  if (!query) return out
  const { folded: hay, starts, ends } = foldCase(text)
  const needle = query.toLowerCase()
  let from = 0
  for (;;) {
    const i = hay.indexOf(needle, from)
    if (i === -1) return out
    out.push({ start: starts[i], end: ends[i + needle.length - 1] })
    // Advance past this match, so "aa" in "aaaa" is two matches and not three:
    // overlapping hits cannot both be highlighted anyway.
    from = i + needle.length
    // A pathological document should not become a hang.
    if (out.length >= 5000) return out
  }
}
/** Which match to land on when the bar opens or the query changes. */
export function firstAfter(matches: Match[], offset: number): number {
  if (!matches.length) return -1
  const i = matches.findIndex((m) => m.start >= offset)
  return i === -1 ? 0 : i
}

/** Step through the matches, wrapping at both ends. */
export function stepMatch(count: number, current: number, delta: number): number {
  if (count <= 0) return -1
  return (((current + delta) % count) + count) % count
}
