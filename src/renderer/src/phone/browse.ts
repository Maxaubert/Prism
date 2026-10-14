/**
 * The phone browser's arithmetic (2026-09-06, #104), pure: where "up" goes,
 * what the crumb row says, and which file is next. Paths are Windows paths
 * handed over by the PC, compared without case.
 *
 * SINCE 2026-10-14 THERE IS NO ROOT: the phone browses the whole PC like the
 * Explorer, and the top of every path is THIS PC, spelled '' (`THIS_PC`),
 * which is the places page. A drive's top goes up to it, and nothing goes up
 * from it.
 */
import type { SearchHit, ViewerFile } from '@shared/types'
import { baseName, samePath, trimSep } from '@shared/path'

/** One folder, however the two were spelled: case and a trailing separator do
 *  not make two folders, on Windows or in the wall main keeps. */
export { samePath }

/** The places page: Quick access and the drives. */
export const THIS_PC = ''

/** A local absolute path, the only kind the PC lists for a phone: what a URL
 *  handed back is checked against before it is believed. */
export function isLocalPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p)
}

/** A drive's top, "C:\" however it was spelled. */
function isDriveTop(p: string): boolean {
  return /^[A-Za-z]:$/.test(trimSep(p))
}

/** The folder above `dir`: a drive's top goes to This PC, This PC has none. */
export function parentOf(dir: string): string | null {
  if (dir === THIS_PC) return null
  if (isDriveTop(dir)) return THIS_PC
  const d = trimSep(dir)
  const i = d.lastIndexOf('\\')
  if (i <= 0) return THIS_PC
  const up = d.slice(0, i)
  return isDriveTop(up) ? `${up}\\` : up
}

/** This PC, then the drive, then each folder down to `dir`, one crumb each. */
export function crumbs(dir: string): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = []
  let at: string | null = dir
  while (at !== null && at !== THIS_PC) {
    out.unshift(isDriveTop(at) ? { name: trimSep(at), path: `${trimSep(at)}\\` } : { name: baseName(at), path: trimSep(at) })
    at = parentOf(at)
  }
  out.unshift({ name: 'This PC', path: THIS_PC })
  return out
}

/**
 * A search hit as the file a row hands the viewer. A hit carries a path, a
 * name and a kind, which is everything the viewers read; the SIZE it does not
 * carry is left at 0 rather than fetched, because the one place a size shows
 * is the archive header's "N compressed", which omits the clause when there
 * is none. The extension is lower-cased, as `toViewerFile` does, so the
 * icon's chip and the kind tests read the same on both hosts.
 */
export function fileFromHit(hit: SearchHit): ViewerFile {
  const dot = hit.name.lastIndexOf('.')
  return {
    path: hit.path,
    name: hit.name,
    ext: dot > 0 ? hit.name.slice(dot).toLowerCase() : '',
    kind: hit.kind,
    size: 0,
    mtimeMs: 0
  }
}

/** The file after (or before) `current` in the folder's own order; null at
 *  either end, and null when `current` is not in the list at all. */
export function stepFile(files: ViewerFile[], current: string, dir: 1 | -1): ViewerFile | null {
  const i = files.findIndex((f) => f.path === current)
  if (i < 0) return null
  return files[i + dir] ?? null
}
