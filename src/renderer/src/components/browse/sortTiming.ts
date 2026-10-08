import { time } from 'prism-term-core/renderer/lib/diag'
import type { DirListing } from '@shared/types'
import type { FolderSizes } from '../../lib/folderSize'
import { browseEntries } from './entries'
import type { BrowseEntry, BrowseSort } from './types'

/**
 * THE SORT-AND-FILTER PASS TIMES ITSELF (#322). Suspect 3 of the diagnostics
 * design is a full re-sort of the Explorer's rows on every folder-size tick.
 * A pass of 50 ms or more is written as `sort-slow`, with the row count and
 * the input that made it run again, so the log can say whether the sizes are
 * what keeps re-sorting a big folder.
 */

/** What one pass is made from (`browseEntries`' inputs). */
export interface SortInputs {
  listing: DirListing | null
  query: string
  sort: BrowseSort
  sizes: FolderSizes
  dated: boolean
}

/**
 * Which input made a pass run again: a new folder (`listing`), a folder-size
 * tick (`sizes`), typing (`query`), a column (`sort`) or the date grouping
 * (`dates`). The first pass of a list is `listing`. Checked in that order: a
 * pass with a new listing is the listing's, whatever else moved with it.
 */
export function sortTrigger(prev: SortInputs | null, next: SortInputs): string {
  if (!prev || prev.listing !== next.listing) return 'listing'
  if (prev.sizes !== next.sizes) return 'sizes'
  if (prev.query !== next.query) return 'query'
  if (prev.sort.key !== next.sort.key || prev.sort.direction !== next.sort.direction) return 'sort'
  if (prev.dated !== next.dated) return 'dates'
  return 'other'
}

export const SORT_SLOW_MS = 50
/** At most one `sort-slow` line per trigger in this long (review of #322). */
export const SORT_SLOW_EVERY_MS = 5000

/**
 * A pass that remembers the inputs of the last, for `trigger`. Made once per
 * list (held in state, not a ref: the pass runs while rendering, inside the
 * list's memo).
 *
 * RATE-GATED (review of #322): the folder sizes publish every 16 ms while a
 * scan runs, so in a folder whose pass takes 50 ms every tick was a line, 10
 * to 20 a second for the whole sweep, enough to roll the log. A trigger's
 * first slow pass is written; the slow passes after it, for
 * `SORT_SLOW_EVERY_MS`, are counted, and the next line written for that
 * trigger carries them as `held` with the slowest as `heldMaxMs`.
 */
export function createSortPass(clock: () => number = () => performance.now()): (inputs: SortInputs) => BrowseEntry[] {
  let last: SortInputs | null = null
  const gates = new Map<string, { sentAt: number; held: number; heldMaxMs: number }>()
  return (inputs) => {
    const trigger = sortTrigger(last, inputs)
    last = inputs
    const rows = inputs.listing ? inputs.listing.folders.length + inputs.listing.files.length : 0
    const t0 = clock()
    const out = browseEntries(inputs.listing, inputs.query, inputs.sort, inputs.sizes, inputs.dated)
    const t1 = clock()
    const ms = t1 - t0
    if (ms < SORT_SLOW_MS) return out
    const gate = gates.get(trigger)
    if (gate && t1 - gate.sentAt < SORT_SLOW_EVERY_MS) {
      gate.held += 1
      gate.heldMaxMs = Math.max(gate.heldMaxMs, Math.round(ms))
      return out
    }
    const held = gate?.held ? { held: gate.held, heldMaxMs: gate.heldMaxMs } : {}
    gates.set(trigger, { sentAt: t1, held: 0, heldMaxMs: 0 })
    // The pass already ran: `time` is handed its measured span as its clock,
    // so the line is the core's own `sort-slow` shape.
    const span = [t0, t1]
    time('sort-slow', () => undefined, { entries: rows, trigger, ...held }, SORT_SLOW_MS, () => span.shift() ?? t1)
    return out
  }
}
