// A member row of the archive panel, and the columns its header and rows
// share (out of ArchiveView.tsx, structure cleanup 2026-10-12).

export type Entry = {
  path: string
  name: string
  dir: boolean
  size: number
  /** What the member occupies inside the container; folders have none. */
  packed?: number
  /** The entry's own modified time, epoch ms, as the container recorded it. */
  mtime?: number
  encrypted?: boolean
}

// The columns, Explorer-shaped. The widths live in one place because the
// header row and every member row have to agree to the pixel, and the narrow
// ones step out of the way on a small window rather than crushing the name:
// the name is the column you cannot do without.
export const COL_TYPE = 'hidden w-[140px] shrink-0 truncate md:block'
export const COL_SIZE = 'w-[86px] shrink-0 text-right tabular-nums'
export const COL_PACKED = 'hidden w-[128px] shrink-0 text-right tabular-nums xl:block'
export const COL_WHEN = 'hidden w-[150px] shrink-0 text-right tabular-nums lg:block'
