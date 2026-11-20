import { describe, expect, it } from 'vitest'
import { readableDirectory } from './readableDirectory'

describe('readableDirectory (audit #88)', () => {
  it('passes a folder that was read', () => {
    const d = { path: 'C:\\a', listing: { files: [] } }
    expect(readableDirectory(d)).toBe(d)
  })
  it('turns an access-denied folder and a missing one into null', () => {
    expect(readableDirectory({ path: 'C:\\no', listing: { unreadable: true } })).toBeNull()
    expect(readableDirectory(null)).toBeNull()
  })
})
