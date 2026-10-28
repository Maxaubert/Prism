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
 * new stays blank until its patch, and the answer says `carried`: the blanks
 * are new rows, not a first visit's, so a Date or Size sort keeps its order
 * (perf review #3, 2026-10-28: Downloads flipped to A-Z on every refresh that
 * brought a new file, and back when its date landed).
 */
export function carryDetails(prev: DirListing | null | undefined, next: DirListing): DirListing {
  if (!prev || next.complete !== false || !(prev.files.length || prev.folders.length)) return next
  const known = new Map<string, { size?: number; mtimeMs?: number }>()
  for (const f of prev.files) if (f.size !== undefined) known.set(lower(f.path), f)
  // A folder's date is carried the same way (#285).
  const dated = new Map<string, number>()
  for (const f of prev.folders) if (f.mtimeMs !== undefined) dated.set(lower(f.path), f.mtimeMs)
  if (!known.size && !dated.size) return next
  let changed = false
  const folders = next.folders.map((f) => {
    const t = f.mtimeMs === undefined ? dated.get(lower(f.path)) : undefined
    if (t === undefined) return f
    changed = true
    return { ...f, mtimeMs: t }
  })
  const files = next.files.map((f) => {
    if (f.size !== undefined) return f
    const old = known.get(lower(f.path))
    if (!old) return f
    changed = true
    return { ...f, size: old.size, mtimeMs: old.mtimeMs }
  })
  return changed ? { ...next, folders, files, carried: true } : next
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
  // Folders take the date only (#285).
  const folders = byPath.size
    ? listing.folders.map((f) => {
        const d = byPath.get(lower(f.path))
        if (!d || d.mtimeMs === f.mtimeMs) return f
        changed = true
        return { ...f, mtimeMs: d.mtimeMs }
      })
    : listing.folders
  if (details.done && listing.complete === false) {
    const { complete: _complete, ...rest } = listing
    void _complete
    return { ...rest, folders, files }
  }
  return changed ? { ...listing, folders, files } : listing
}

/**
 * The same rows as the listing on screen (perf review #18, 2026-10-28): the
 * same paths in the same order, each with the same size and date (or the
 * same blank), and the same hidden count. A re-read that answers this draws
 * nothing new. A place inside an archive never counts as the same: its
 * container's facts ride on the listing too.
 */
export function sameRows(a: DirListing, b: DirListing): boolean {
  if (a === b) return true
  if (
    a.folders.length !== b.folders.length ||
    a.files.length !== b.files.length ||
    a.hidden !== b.hidden ||
    !!a.unreadable !== !!b.unreadable ||
    a.archive ||
    b.archive ||
    a.archiveError ||
    b.archiveError
  )
    return false
  for (let i = 0; i < a.folders.length; i++) {
    const x = a.folders[i]
    const y = b.folders[i]
    if (x.path !== y.path || x.mtimeMs !== y.mtimeMs) return false
  }
  for (let i = 0; i < a.files.length; i++) {
    const x = a.files[i]
    const y = b.files[i]
    if (x.path !== y.path || x.size !== y.size || x.mtimeMs !== y.mtimeMs) return false
  }
  return true
}

/** Some file in it has no size or date yet. */
export const detailsPending = (listing: DirListing | null | undefined): boolean =>
  !!listing && listing.files.some((f) => f.size === undefined || f.mtimeMs === undefined)
