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

/**
 * A pass that remembers the inputs of the last, for `trigger`. Made once per
 * list (held in state, not a ref: the pass runs while rendering, inside the
 * list's memo).
 */
export function createSortPass(): (inputs: SortInputs) => BrowseEntry[] {
  let last: SortInputs | null = null
  return (inputs) => {
    const trigger = sortTrigger(last, inputs)
    last = inputs
    const rows = inputs.listing ? inputs.listing.folders.length + inputs.listing.files.length : 0
    return time(
      'sort-slow',
      () => browseEntries(inputs.listing, inputs.query, inputs.sort, inputs.sizes, inputs.dated),
      { entries: rows, trigger }
    )
  }
}
