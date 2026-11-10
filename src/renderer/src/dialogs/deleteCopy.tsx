import type { JSX } from 'react'
import type { FolderSizeResult } from '@shared/folderSize'
import type { BinDriveUsage } from '@shared/ipcTypes'
import { DialogName } from '../components/DialogName'
import { formatBytes } from '../lib/format'
import { folderSizePartial, type FolderSizes } from '../lib/folderSize'

/**
 * THE WORDS OF THE DELETE QUESTION (#500, #503; owner, 2026-11-10: "minimal
 * text"). Five dialogs say the same thing in the same shape, so the pieces
 * live here: the title, the one quiet line (what is going and how big it is),
 * and the bars of Empty Recycle Bin. Pure, so a test pins every word.
 */

/** How big what goes is: counted (folders take a moment), known, or not knowable. */
export type DeleteSize =
  | { state: 'counting' }
  | { state: 'known'; bytes: number; /** A lower bound: something could not be read. */ partial?: boolean }
  | { state: 'none' }

/** The quiet ellipsis shown until a size is known. */
export const SIZE_PENDING = '…'

export function sizeText(size: DeleteSize | undefined): string {
  if (!size || size.state === 'counting') return SIZE_PENDING
  if (size.state === 'none') return ''
  return `${size.partial ? '≥ ' : ''}${formatBytes(size.bytes)}`
}

/** "Delete a.txt?", "Delete 12 items?", and the same with "permanently". */
export function deleteTitle(names: readonly string[], count: number, permanent: boolean): string {
  const what = count === 1 && names.length ? names[0] : `${count} items`
  return `Delete ${what}${permanent ? ' permanently' : ''}?`
}

/** The names listed in the line of a question about several items. */
const LISTED = 2

/**
 * The line under the title. One item: its size. Several: the first two names,
 * what is left over, then the total ("a.heic, b.mov +10 · 1.4 GB"). The names
 * are the part that gives way when the box is narrow, so the size stays.
 */
export function deleteLine(
  names: readonly string[],
  count: number,
  size: DeleteSize | undefined
): JSX.Element {
  const text = sizeText(size)
  if (count <= 1) return <span data-delete-size>{text}</span>
  const shown = names.slice(0, LISTED)
  const rest = count - shown.length
  return (
    <>
      <span className="min-w-0 truncate" data-delete-names>
        {shown.map((n, i) => (
          <span key={i}>
            {i > 0 && ', '}
            <DialogName>{n}</DialogName>
          </span>
        ))}
      </span>
      <span className="shrink-0 whitespace-pre" data-delete-size>
        {rest > 0 ? ` +${rest}` : ''}
        {text ? ` · ${text}` : ''}
      </span>
    </>
  )
}

/**
 * The total of what is going, filling in as it is counted: the files' own
 * sizes (read once) plus every folder's (counted by the Properties counter,
 * `useFolderSizes`). Counting until every part is in; none when a folder could
 * not be counted at all; partial ("at least") when one could not be read in full.
 */
export function sumDeleteSize(parts: {
  files: readonly number[] | undefined
  folders: readonly string[]
  sizes: FolderSizes
}): DeleteSize {
  if (!parts.files) return { state: 'counting' }
  let bytes = parts.files.reduce((n, b) => n + b, 0)
  let partial = false
  let waiting = false
  for (const path of parts.folders) {
    const s: FolderSizeResult | null | undefined = parts.sizes[path]
    if (s === null) return { state: 'none' }
    if (s === undefined) {
      waiting = true
      continue
    }
    bytes += s.bytes
    if (folderSizePartial(s)) partial = true
  }
  if (waiting) return { state: 'counting' }
  return { state: 'known', bytes, ...(partial ? { partial: true } : {}) }
}

/** The bytes of the zip members that go: every file entry that is one of the
 *  `inners` or lies below one (a folder takes its whole tree). */
export function archiveBytes(
  entries: ReadonlyArray<{ path: string; dir: boolean; size: number }>,
  inners: readonly string[]
): number {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const goes = inners.map(norm)
  let bytes = 0
  for (const e of entries) {
    if (e.dir) continue
    const p = norm(e.path)
    if (goes.some((g) => p === g || p.startsWith(`${g}/`))) bytes += e.size
  }
  return bytes
}

/** "1 item", "38 items". */
export const itemsText = (n: number): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? 'item' : 'items'}`

/** One drive's bar in Empty Recycle Bin's question. `stays` and `freed` are
 *  shares of the drive (0 to 1); they are absent when the drive gave no size. */
export interface DriveBar {
  /** `C:` */
  drive: string
  /** The used part that stays used. */
  stays?: number
  /** The used part the bin holds: what Empty gives back. */
  freed?: number
  /** "212 GB free" */
  freeText?: string
  /** "+1.4 GB" */
  freedText: string
}

export function emptyBars(drives: readonly BinDriveUsage[]): DriveBar[] {
  return drives.map((d) => {
    const drive = d.path.slice(0, 2).toUpperCase()
    const freedText = `+${formatBytes(d.bytes)}`
    if (d.total === undefined || d.free === undefined || !(d.total > 0)) return { drive, freedText }
    const used = Math.max(d.total - d.free, 0)
    const freed = Math.min(d.bytes, used)
    return {
      drive,
      stays: (used - freed) / d.total,
      freed: freed / d.total,
      freeText: `${formatBytes(d.free)} free`,
      freedText
    }
  })
}
