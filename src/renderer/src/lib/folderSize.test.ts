import { describe, expect, it } from 'vitest'
import type { FolderSizeResult } from '@shared/folderSize'
import { folderSizeCoverage, folderSizeLabel } from './folderSize'

const complete: FolderSizeResult = {
  bytes: 42,
  files: 2,
  folders: 1,
  unreadable: 0,
  skippedLinks: 0,
  truncated: false
}

describe('folder size coverage', () => {
  it('distinguishes current filesystem, saved and indexed totals', () => {
    expect(folderSizeLabel(complete)).toBe('42 B')
    expect(folderSizeLabel({ ...complete, stale: true })).toBe('≈ 42 B')
    expect(folderSizeCoverage({ ...complete, stale: true })).toContain('Saved size; refreshing')
    expect(folderSizeLabel({ ...complete, source: 'index' })).toBe('≈ 42 B')
    expect(folderSizeCoverage({ ...complete, source: 'index' })).toContain(
      'unindexed files are not counted'
    )
  })

  it('preserves the partial scan lower bound and coverage details', () => {
    const partial = { ...complete, unreadable: 1, skippedLinks: 1, truncated: true }
    expect(folderSizeLabel(partial)).toBe('≥ 42 B')
    expect(folderSizeCoverage(partial)).toBe(
      'Partial total: 1 unreadable items; 1 links skipped; Scan limit reached'
    )
  })
})
