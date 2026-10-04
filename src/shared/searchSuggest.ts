/**
 * THE SEARCH POPUP'S SHORT LIST (#267; owner, 2026-10-04, showing PowerToys
 * Run: "in the search pop up you'll see the relevant recommendations, the most
 * likely ones, and at the bottom there's a show more which essentially does a
 * normal search like before"). Pure, and shared: main keeps the best 200 of
 * what its search found by `nameRank` (browseSuggest), and the popup picks the
 * few most likely of those with `rankSuggestions`.
 *
 * Most likely means the NAME answers the query: the whole name, then its
 * start, then the start of a word in it, then anywhere in it. Hits that only
 * matched through an operator or a glob come after. Within a rank, the one
 * nearer the folder you are in wins, then a folder over a file (a folder is a
 * place to go), then the shorter name.
 */

export interface SuggestHit {
  path: string
  name: string
  isFolder: boolean
}

/** How many the popup holds before "Show more" (owner, 2026-10-04: "can hold
 *  a bit more items, so you can scroll", 50, then "maybe 25 items instead of
 *  50"). It was 8. */
export const SUGGEST_COUNT = 25

const stem = (name: string): string => name.replace(/\.[^.]+$/, '')

/** The words a person typed, without the search's operators: quotes, `ext:`,
 *  `folder:`/`file:` prefixes, exclusions and globs say how to match, not
 *  what the name is. */
export function plainWords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/"/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !word.startsWith('-') && !/[*?]/.test(word))
    .map((word) => word.replace(/^(ext|folder|file|type|path):/, ''))
    .filter((word) => word && !word.includes(':') && !word.includes(';'))
}

/** 0 is the best answer. */
export function nameRank(name: string, query: string): number {
  const words = plainWords(query)
  if (!words.length) return 4
  const lower = name.toLowerCase()
  const phrase = words.join(' ')
  if (lower === phrase || stem(lower) === phrase) return 0
  if (lower.startsWith(phrase)) return 1
  const parts = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (words.every((word) => parts.some((part) => part.startsWith(word)))) return 2
  if (words.every((word) => lower.includes(word))) return 3
  return 4
}

const depth = (path: string, root: string): number => {
  const rest = path.slice(root.replace(/[\\/]+$/, '').length)
  return rest.split(/[\\/]/).filter(Boolean).length
}

export function rankSuggestions<T extends SuggestHit>(
  hits: readonly T[],
  query: string,
  root: string,
  count = SUGGEST_COUNT
): T[] {
  return hits
    .map((hit, order) => ({ hit, order, rank: nameRank(hit.name, query), depth: depth(hit.path, root) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.depth - b.depth ||
        Number(b.hit.isFolder) - Number(a.hit.isFolder) ||
        a.hit.name.length - b.hit.name.length ||
        a.order - b.order
    )
    .slice(0, count)
    .map(({ hit }) => hit)
}

/** Where a hit lives, said from the folder you are in: its own folder's path
 *  under `root`, or the folder's name when it sits right in it. */
export function hitFolder(path: string, root: string): string {
  const base = root.replace(/[\\/]+$/, '')
  const parent = path.replace(/[\\/][^\\/]*$/, '')
  if (parent.toLowerCase() === base.toLowerCase()) return base.split(/[\\/]/).pop() || base
  if (parent.toLowerCase().startsWith(base.toLowerCase() + '\\') || parent.toLowerCase().startsWith(base.toLowerCase() + '/'))
    return parent.slice(base.length + 1)
  return parent
}

/**
 * The highlighted row as the arrows walk it. The rows are the matches and,
 * when there is a query, "Show more" after them (index `count`). -1 is none:
 * nothing is marked until somebody walks or points (Prism Terminal's command
 * help, the same rule). Wraps at both ends, as a menu does.
 */
export function stepActive(active: number, count: number, delta: 1 | -1, showMore: boolean): number {
  const total = count + (showMore ? 1 : 0)
  if (!total) return -1
  if (active < 0) return delta > 0 ? 0 : total - 1
  return (active + delta + total) % total
}
