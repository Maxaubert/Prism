/**
 * FUZZY SEARCH FOR THE FOLDER ICON PICKER (owner, 2026-10-31: "should also be
 * fuzzy searchable"). Pure, and fast enough to run on every key over the whole
 * built-in set (2,015 names with their tags): the haystacks are folded once,
 * when the set loads, and a query only compares strings.
 *
 * Every word of the query must match. A word scores best as the whole name,
 * then the start of the name, then a word of the name, then a tag (whole, then
 * the start of one), then as letters of the name in order (fzf's way: `cmra`
 * finds camera, `fldr` folder), where letters that start a word or follow the
 * one before score more and the letters skipped cost. Ties sort by name.
 */

/** Lower case, accents gone (the settings search's `fold`, same rule). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const split = (text: string): string[] => text.split(/[^a-z0-9]+/).filter(Boolean)

/** One searchable thing, folded once. */
export interface Haystack {
  name: string
  /** The name's words ("folder-open": folder, open). */
  words: string[]
  /** Where each word starts in `name`. */
  starts: Set<number>
  tags: string[]
  /** Every word of every tag. */
  tagWords: string[]
}

export function haystack(name: string, tags: readonly string[] = []): Haystack {
  const n = fold(name)
  const starts = new Set<number>()
  for (let i = 0; i < n.length; i += 1)
    if (/[a-z0-9]/.test(n[i]) && (i === 0 || !/[a-z0-9]/.test(n[i - 1]))) starts.add(i)
  const folded = tags.map(fold)
  return { name: n, words: split(n), starts, tags: folded, tagWords: folded.flatMap(split) }
}

/** The query as words to match, folded. */
export function queryWords(query: string): string[] {
  return split(fold(query))
}

/** Letters of `w` found in order in the name, scored; 0 when they are not all there. */
function subsequence(h: Haystack, w: string): number {
  const n = h.name
  let at = 0
  let score = 100
  let last = -2
  for (const ch of w) {
    const i = n.indexOf(ch, at)
    if (i < 0) return 0
    if (h.starts.has(i)) score += 8
    if (i === last + 1) score += 10
    else score -= 3 * (i - (last < 0 ? 0 : last + 1))
    last = i
    at = i + 1
  }
  score -= (n.length - w.length) * 0.5
  // Always below a tag hit, always a hit.
  return Math.max(1, Math.min(199, score))
}

/** How well one query word matches; 0 is no match. */
export function wordScore(h: Haystack, w: string): number {
  if (h.name === w) return 1000
  if (h.name.startsWith(w)) return 800 - Math.min(99, h.name.length - w.length)
  if (h.words.includes(w)) return 700 - Math.min(99, h.name.length)
  if (h.words.some((x) => x.startsWith(w))) return 600 - Math.min(99, h.name.length)
  if (h.tags.includes(w) || h.tagWords.includes(w)) return 400
  if (h.tagWords.some((x) => x.startsWith(w))) return 300
  return subsequence(h, w)
}

/** The whole query's score; 0 when any word misses. */
export function fuzzyScore(h: Haystack, words: readonly string[]): number {
  let total = 0
  for (const w of words) {
    const s = wordScore(h, w)
    if (!s) return 0
    total += s
  }
  return total
}

/**
 * The indexes of `hay` that match `query`, best first (ties by name). An empty
 * query is every index in its own order.
 */
export function fuzzyFilter(hay: readonly Haystack[], query: string): number[] {
  const words = queryWords(query)
  if (!words.length) return hay.map((_, i) => i)
  const hits: Array<{ i: number; s: number }> = []
  for (let i = 0; i < hay.length; i += 1) {
    const s = fuzzyScore(hay[i], words)
    if (s) hits.push({ i, s })
  }
  hits.sort((a, b) => b.s - a.s || (hay[a.i].name < hay[b.i].name ? -1 : hay[a.i].name > hay[b.i].name ? 1 : 0))
  return hits.map((h) => h.i)
}
