import { fileKind } from '@shared/fileKind'
import type { DirListing } from '@shared/types'
import type { LandingRow } from '../../lib/jobs'

/**
 * WHAT A PASTE IS STILL COPYING, AS LIST ROWS (owner, 2026-10-28: "nothing
 * happens and suddenly items just appear"), cheap enough for a big paste into
 * a big folder (review, 2026-10-28: each progress message filtered every item
 * against the whole listing, lower-casing both, and re-sorted the folder).
 *
 * The ROW SET (which items, where they will land) changes only when an item
 * starts or its file shows up; the percentages change every tick. So the
 * merged listing is built from `rowsKey` alone, and the bars read `pcts`: a
 * progress tick redraws bars and never re-sorts the folder.
 */

/** The listing's paths, lower-cased, to test a row against in O(1). */
export function listedPaths(listing: DirListing | null | undefined): ReadonlySet<string> {
  const out = new Set<string>()
  if (!listing) return out
  for (const f of listing.folders) out.add(f.path.toLowerCase())
  for (const f of listing.files) out.add(f.path.toLowerCase())
  return out
}

/** The rows whose file the listing does not have yet. */
export function unlisted(rows: readonly LandingRow[], listed: ReadonlySet<string>): LandingRow[] {
  return rows.filter((r) => !listed.has(r.path.toLowerCase()))
}

type RowShape = [path: string, name: string, isFolder: boolean, since: number]

/** A string that changes only when the row set does, never with a percentage. */
export function rowsKey(rows: readonly LandingRow[]): string {
  return rows.length
    ? JSON.stringify(rows.map((r): RowShape => [r.path, r.name, r.isFolder, r.since]))
    : ''
}

/** Each row's progress by lower-cased path, for the list's bars. */
export function landingPcts(rows: readonly LandingRow[]): ReadonlyMap<string, number> | undefined {
  return rows.length ? new Map(rows.map((r) => [r.path.toLowerCase(), r.pct])) : undefined
}

/** The listing with the rows of `key` joined in where they will land. */
export function withLanding(listing: DirListing | null, key: string): DirListing | null {
  if (!key || !listing) return listing
  const rows = JSON.parse(key) as RowShape[]
  const dot = (n: string): string => {
    const i = n.lastIndexOf('.')
    return i > 0 ? n.slice(i).toLowerCase() : ''
  }
  return {
    ...listing,
    folders: [
      ...listing.folders,
      ...rows.filter((r) => r[2]).map(([path, name, , since]) => ({ path, name, mtimeMs: since }))
    ],
    files: [
      ...listing.files,
      ...rows
        .filter((r) => !r[2])
        .map(([path, name, , since]) => ({
          path,
          name,
          ext: dot(name),
          kind: fileKind(dot(name), name),
          size: 0,
          mtimeMs: since
        }))
    ]
  }
}
