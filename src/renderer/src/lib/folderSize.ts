import type { FolderSizeResult } from '@shared/folderSize'
import { formatBytes } from './format'

export type FolderSizes = Record<string, FolderSizeResult | null | undefined>

export function folderSizePartial(size: FolderSizeResult): boolean {
  return size.unreadable > 0 || size.skippedLinks > 0 || size.truncated
}

export function folderSizeLabel(size: FolderSizeResult | null | undefined): string {
  if (size === undefined) return 'Calculating…'
  if (size === null) return 'Unavailable'
  return `${size.stale || size.source === 'index' ? '≈ ' : folderSizePartial(size) ? '≥ ' : ''}${formatBytes(size.bytes)}`
}

export function folderSizeCoverage(size: FolderSizeResult): string {
  const notes: string[] = []
  if (size.stale) notes.push('Saved size; refreshing')
  if (size.source === 'index')
    notes.push('Indexed files only; excluded or unindexed files are not counted')
  if (size.unreadable) notes.push(`${size.unreadable} unreadable items`)
  if (size.skippedLinks) notes.push(`${size.skippedLinks} links skipped`)
  if (size.truncated) notes.push('Scan limit reached')
  return notes.length
    ? `${folderSizePartial(size) ? 'Partial total: ' : ''}${notes.join('; ')}`
    : 'Includes files in all subfolders'
}
