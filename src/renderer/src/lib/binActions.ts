import { BIN_PLACE } from '@shared/binPlace'
import { pathKey } from '@shared/path'
import { stoppedNote } from './fileJob'

/**
 * THE PURE HALF OF THE BIN'S ACTIONS (Recycle Bin, D13 to D17): which lists a
 * job holds, the names a question shows, the lines said when it ends. The
 * hook (`useBinOps`) is the half with effects.
 */

/** The lists a bin job changes: the bin itself, and for a Restore every
 *  folder an item goes back to (`from` answers for one bin path). */
export function binHoldDirs(paths: readonly string[], from: (path: string) => string | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = [BIN_PLACE]
  for (const p of paths) {
    const dir = from(p)
    if (!dir || seen.has(pathKey(dir))) continue
    seen.add(pathKey(dir))
    out.push(dir)
  }
  return out
}

/** The original names of these bin paths, in the order asked; a path the
 *  listing no longer has is left out. */
export function namesOfBinPaths(
  paths: readonly string[],
  rows: ReadonlyArray<{ path: string; name: string }>
): string[] {
  const byPath = new Map(rows.map((r) => [r.path, r.name]))
  return paths.flatMap((p) => (byPath.has(p) ? [byPath.get(p) as string] : []))
}

/** The total size of these bin paths from the listing (the `$I` sizes), or
 *  undefined when any is missing or has no size (the question then says no size). */
export function bytesOfBinPaths(
  paths: readonly string[],
  rows: ReadonlyArray<{ path: string; size?: number }>
): number | undefined {
  const bySize = new Map(rows.map((r) => [r.path, r.size]))
  let total = 0
  for (const p of paths) {
    const size = bySize.get(p)
    if (size === undefined) return undefined
    total += size
  }
  return total
}

/** A Restore that left items in the bin (locked, denied, the drive gone). */
export const binRestoreFailure = (failed: number, total: number): string =>
  total === 1 ? 'That could not be put back.' : `${failed} of ${total} could not be put back.`

/** A Delete permanently or an Empty that could not remove everything. */
export const binDeleteFailure = (failed: number, total: number): string =>
  total === 1 ? 'That could not be deleted.' : `${failed} of ${total} could not be deleted.`

/** "Stopped. Restored 120 of 500." (the quiet line after Cancel). */
export const binStopped = stoppedNote
