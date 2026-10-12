/**
 * THE DRIVE DONUT'S ARITHMETIC (owner, 2026-10-12; spec
 * `docs/superpowers/specs/2026-10-12-properties-window-design.md`, Drive).
 * Pure, so the slices are tested without a DOM: `DriveDonut.tsx` only draws
 * what this answers.
 *
 * The seven biggest folders take the accent, the kind colours and the archive
 * colour, in that order; the rest share the text kind's grey. A slice under
 * 0.15% of the drive is not drawn (a hairline nobody can hover) but keeps its
 * legend row and its place, so the slices after it sit where they should.
 */

export const DONUT_COLOURS = [
  'var(--p-accent)',
  'var(--p-kind-video)',
  'var(--p-kind-image)',
  'var(--p-kind-audio)',
  'var(--p-kind-pdf)',
  'var(--p-tree-archive)',
  'var(--p-kind-folder)'
] as const
export const DONUT_REST = 'var(--p-kind-text)'
/** Under this share of the drive a slice is legend only. */
export const DONUT_FLOOR = 0.0015

export interface DonutFolder {
  name: string
  path: string
  bytes: number
}

export interface DonutSlice extends DonutFolder {
  color: string
  /** Of the whole drive, 0..1. */
  fraction: number
  /** Where it starts round the ring, as a fraction of the drive. */
  offset: number
  drawn: boolean
}

/** One slice per folder, in the order given (main sends them biggest first). */
export function donutSlices(folders: DonutFolder[], total: number | undefined): DonutSlice[] {
  const whole = total && total > 0 ? total : 0
  let at = 0
  return folders.map((f, i) => {
    // An index that over-counts (hard links, a stale answer) never runs the
    // ring past a full turn.
    const raw = whole ? Math.max(0, f.bytes) / whole : 0
    const fraction = Math.min(raw, Math.max(0, 1 - at))
    const slice: DonutSlice = {
      ...f,
      color: i < DONUT_COLOURS.length ? DONUT_COLOURS[i] : DONUT_REST,
      fraction,
      offset: at,
      drawn: fraction >= DONUT_FLOOR
    }
    at += fraction
    return slice
  })
}

/** Used against free, for a drive the search index could not answer. */
export function usedFraction(total: number | undefined, free: number | undefined): number {
  if (!total || total <= 0 || free === undefined) return 0
  return Math.min(1, Math.max(0, (total - free) / total))
}

/** "34%", "<1%" for a sliver, empty for nothing at all. */
export function sharePercent(bytes: number, total: number | undefined): string {
  if (!total || total <= 0 || bytes <= 0) return ''
  const p = (bytes / total) * 100
  return p >= 1 ? `${Math.round(p)}%` : '<1%'
}

const KB = 1024
const MB = KB ** 2
const GB = KB ** 3
const TB = KB ** 4

/**
 * The donut's own sizes, as the approved mockup reads them: terabytes to two
 * places ("3.56 TB of 7.28 TB", a drive's scale), gigabytes to one under 100,
 * megabytes and kilobytes whole, and "Empty" for a folder with nothing in it.
 */
export function donutBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return 'Empty'
  if (b >= TB) return `${(b / TB).toFixed(2).replace(/\.?0+$/, '')} TB`
  if (b >= GB) return `${(b / GB).toFixed(b >= 100 * GB ? 0 : 1).replace(/\.0$/, '')} GB`
  if (b >= MB) return `${Math.round(b / MB)} MB`
  return `${Math.max(1, Math.round(b / KB))} KB`
}
