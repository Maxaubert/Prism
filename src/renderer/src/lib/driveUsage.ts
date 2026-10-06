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

/** The share used as a whole percent, for the Tiles and Ring labels. */
export function usedPercent(total?: number, free?: number): number | null {
  const used = usedFraction(total, free)
  return used === null ? null : Math.round(used * 100)
}

/** From this share used the drive wears the warning colour, as File Explorer
 *  turns its bar red (the drive row mockups, 2026-10-06). */
export const WARN_AT = 0.9

export function nearlyFull(total?: number, free?: number): boolean {
  const used = usedFraction(total, free)
  return used !== null && used >= WARN_AT
}

/** The Gauge's lit steps out of `steps`. At least one for anything in use, so
 *  a nearly empty drive still shows it holds something; none when empty. */
export function gaugeSteps(total?: number, free?: number, steps = 20): number {
  const used = usedFraction(total, free)
  if (!used) return 0
  return Math.min(steps, Math.max(1, Math.round(used * steps)))
}

/** The Ring's stroke: the used arc, then the whole circle, for a circle of
 *  radius `r`. Never quite zero, so an empty drive's arc is not a missing
 *  attribute. */
export function ringDash(used: number, r: number): string {
  const c = 2 * Math.PI * r
  return `${Math.max(0.01, Math.min(1, used) * c).toFixed(2)} ${c.toFixed(2)}`
}

/** Free and total on their own, for the Gauge's two ends. */
export function driveSizes(total?: number, free?: number): { free: string; total: string } | null {
  if (usedFraction(total, free) === null) return null
  return { free: formatBytes(Math.min(free!, total!)), total: formatBytes(total!) }
}

/** Which glyph a drive wears: the USB stick for a removable one. */
export function driveGlyph(kind?: BrowseDriveUsage['kind']): 'usb' | 'drive' {
  return kind === 'removable' ? 'usb' : 'drive'
}
