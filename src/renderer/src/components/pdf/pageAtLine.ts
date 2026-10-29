/**
 * The page crossing `line`: the last page whose top is at or above it, so a
 * line in the gap between two pages still names the one above, and a line
 * above the first page names page 1.
 *
 * A BINARY SEARCH (perf review, 2026-10-28). The pages are one column, top to
 * bottom, so their tops only grow, and the scroll handler used to read the
 * rect of every page of the document on every scroll event: a thousand reads a
 * frame on a thousand-page PDF. This reads about ten. `top` answers null for a
 * page with no element yet, and then every page is read in turn, as before.
 */
export function pageAtLine(count: number, top: (n: number) => number | null, line: number): number {
  let lo = 1
  let hi = count
  let best = 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const t = top(mid)
    if (t === null) return linear(count, top, line)
    if (t <= line) {
      best = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return best
}

function linear(count: number, top: (n: number) => number | null, line: number): number {
  let best = 1
  for (let n = 1; n <= count; n++) {
    const t = top(n)
    if (t !== null && t <= line) best = n
  }
  return best
}
