import type { SearchHit } from '@shared/types'
import { matchesQuery, parseQuery } from '@shared/searchQuery'

/**
 * What the phone draws while the PC is still walking (owner, 2026-09-08:
 * "search on mobile is very slow").
 *
 * MEASURED through the real route against a Downloads root, the walk itself
 * answers in 73ms to 357ms, so the server is not what is slow. What is slow is
 * the WAIT: 180ms of debounce, then a Wi-Fi round trip, and until 2026-09-08
 * the list went blank for all of it - every keystroke emptied the screen and
 * refilled it, which reads as a search that cannot keep up rather than as one
 * that is thinking.
 *
 * So the page narrows the answer it already has, locally, with the DESKTOP'S
 * OWN MATCHER (`shared/searchQuery`) rather than a second reading of the
 * grammar - a phone that guessed at what `ext:` or a glob means would show
 * rows the PC is about to disagree with. It is a PREVIEW and never an answer:
 * the walk's reply replaces it whole, and this only ever removes rows that are
 * already on screen.
 *
 * Two things it deliberately refuses to guess. A query that got SHORTER can
 * only widen the answer, and widening needs the files - so the rows stay as
 * they are. And a growth does not always narrow (`*.mp` to `*.mp4`, `ext:mp`
 * to `ext:mp4` match different sets entirely), so a narrowing that empties the
 * list is treated as the guess it is: the last answer stays up, with the page
 * saying a search is still running, rather than a hole where the rows were.
 */
export function narrowHits(
  prev: { q: string; hits: SearchHit[] } | null,
  query: string
): SearchHit[] | null {
  if (!prev || !query) return null
  // Only a query that CONTAINS the last one can be a narrowing of it. Cheap,
  // and it is the test that makes the filter below sound rather than lucky.
  if (!query.startsWith(prev.q)) return prev.hits
  const terms = parseQuery(query)
  if (!terms.length) return prev.hits
  const kept = prev.hits.filter((h) => matchesQuery(h.name, terms))
  // Same array, not a copy, when nothing went: the rows are keyed by path and
  // an identical list is a render nobody needed.
  if (kept.length === prev.hits.length) return prev.hits
  return kept.length ? kept : prev.hits
}
