import type { BrowseDetails, DirListing } from '@shared/types'

/**
 * NAMES FIRST, THEN THE DETAILS (#271). A folder arrives as names, and its
 * files' sizes and dates follow as patches. These two pure steps are the
 * whole of the merge, so the rows are only ever filled in, never rebuilt:
 * the selection and the scroll stay where they are, because nothing they
 * hang on (the paths, the order by name) changes.
 */

const lower = (path: string): string => path.toLowerCase()

/**
 * A fresh names-only answer for a folder already on screen keeps the sizes and
 * dates it had for the files still there (the owner's approved
 * recommendation 3: a cached value may be stale for a moment and is corrected
 * at once), so a revisit never blanks cells that were filled. A file that is
 * new stays blank until its patch.
 */
export function carryDetails(prev: DirListing | null | undefined, next: DirListing): DirListing {
  if (!prev || next.complete !== false || !prev.files.length) return next
  const known = new Map<string, { size?: number; mtimeMs?: number }>()
  for (const f of prev.files) if (f.size !== undefined) known.set(lower(f.path), f)
  if (!known.size) return next
  let changed = false
  const files = next.files.map((f) => {
    if (f.size !== undefined) return f
    const old = known.get(lower(f.path))
    if (!old) return f
    changed = true
    return { ...f, size: old.size, mtimeMs: old.mtimeMs }
  })
  return changed ? { ...next, files } : next
}

/** Lay a details patch over a listing. The last patch makes it complete. */
export function applyDetails(listing: DirListing, details: BrowseDetails): DirListing {
  const byPath = new Map(details.files.map((f) => [lower(f.path), f]))
  let changed = false
  const files = byPath.size
    ? listing.files.map((f) => {
        const d = byPath.get(lower(f.path))
        if (!d || (d.size === f.size && d.mtimeMs === f.mtimeMs)) return f
        changed = true
        return { ...f, size: d.size, mtimeMs: d.mtimeMs }
      })
    : listing.files
  if (details.done && listing.complete === false) {
    const { complete: _complete, ...rest } = listing
    void _complete
    return { ...rest, files }
  }
  return changed ? { ...listing, files } : listing
}

/** Some file in it has no size or date yet. */
export const detailsPending = (listing: DirListing | null | undefined): boolean =>
  !!listing && listing.files.some((f) => f.size === undefined || f.mtimeMs === undefined)
