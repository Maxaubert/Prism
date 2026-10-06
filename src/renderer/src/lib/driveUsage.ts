import type { BrowseDriveUsage } from '@shared/browse'
import { formatBytes } from './format'

/**
 * What a This PC row says (#296): the drive's name the way File Explorer
 * writes it, how much of it is used as a fraction for the bar, and the dim
 * line under it. Pure, so the arithmetic is tested apart from the panel.
 */

const DEFAULT_NAME: Record<NonNullable<BrowseDriveUsage['kind']>, string> = {
  local: 'Local Disk',
  removable: 'USB Drive',
  network: 'Network Drive',
  optical: 'CD Drive'
}

/** "Local Disk (C:)", "Data (D:)": the label, else Windows' own word for the
 *  drive's kind, then the letter. A path that is not a drive root is itself. */
export function driveName(path: string, usage?: Pick<BrowseDriveUsage, 'label' | 'kind'>): string {
  const letter = /^([a-z]):[\\/]?$/i.exec(path)?.[1]?.toUpperCase()
  if (!letter) return path
  const label = usage?.label?.trim() || DEFAULT_NAME[usage?.kind ?? 'local']
  return `${label} (${letter}:)`
}

/** Used over total, 0 to 1; null when the sizes are missing or nonsense. */
export function usedFraction(total?: number, free?: number): number | null {
  if (total === undefined || free === undefined) return null
  if (!Number.isFinite(total) || !Number.isFinite(free) || total <= 0) return null
  return Math.min(1, Math.max(0, (total - free) / total))
}

/** The bar's width, a percentage with one decimal ("61.8%"), so the e2e can
 *  read the same number back off the page. */
export function usedWidth(total?: number, free?: number): string | null {
  const used = usedFraction(total, free)
  return used === null ? null : `${Math.round(used * 1000) / 10}%`
}

/** "382 GB free of 931 GB", in the sizes the Explorer's list uses. */
export function freeLine(total?: number, free?: number): string {
  if (usedFraction(total, free) === null) return ''
  return `${formatBytes(Math.min(free!, total!))} free of ${formatBytes(total!)}`
}
