import { basename, resolve } from 'path'
import type { FolderBreakdown } from '@shared/props'

/**
 * A FOLDER'S OWN RING (owner, 2026-11-17: "let me click for example users and
 * it then opens a new diagram which shows within that folder what takes up
 * space"). Pure: the sizes come from the search index, the folder list from
 * the disk, and this only puts them together, so it is tested without either.
 */

/** A plain absolute path on a drive (`C:\Users`), already in its resolved
 *  form: no `..`, no UNC, no device paths. Only numbers and folder names
 *  leave main for it, as the Explorer would show them. */
export function breakdownTarget(p: unknown): string | null {
  if (typeof p !== 'string' || !/^[A-Z]:\\/i.test(p) || p.includes('\0')) return null
  const r = resolve(p)
  // A trailing backslash is fine (`C:\Users\`); anything resolve changes
  // beyond that (`..`, `.`, doubled separators, forward slashes) is refused.
  return r === p || r === p.replace(/\\+$/, '') ? r : null
}

/** The folder's breakdown, or null when the index knows nothing of it. */
export function breakdownOf(
  folder: string,
  folders: readonly string[],
  sizes: ReadonlyMap<string, { bytes: number }> | null
): FolderBreakdown | null {
  if (!sizes) return null
  const own = sizes.get(folder)?.bytes
  const kids = folders
    .filter((path) => sizes.has(path))
    .map((path) => ({ path, name: basename(path), bytes: Math.max(0, sizes.get(path)!.bytes) }))
    .sort((a, b) => b.bytes - a.bytes)
  if (own === undefined && !kids.length) return null
  const inFolders = kids.reduce((sum, k) => sum + k.bytes, 0)
  // An index that over-counts a folder (hard links, a stale answer) never
  // makes the whole smaller than its parts.
  const bytes = Math.max(own ?? 0, inFolders)
  return { bytes, files: Math.max(0, bytes - inFolders), folders: kids }
}
