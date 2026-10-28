import { describe, expect, it } from 'vitest'
import { sameDrive } from './useDriveUsage'

// Perf review #33 (2026-10-28): a poll whose answer says what the last one
// said leaves the places panel's map as it is, so nothing re-renders.
describe('sameDrive', () => {
  const c = { path: 'C:\\', label: 'Windows', kind: 'local' as const, system: true, total: 100, free: 40 }

  it('is the same answer when every field the panel draws matches', () => {
    expect(sameDrive(c, { ...c })).toBe(true)
  })

  it('differs on free space, the name, the kind or a first answer', () => {
    expect(sameDrive(c, { ...c, free: 39 })).toBe(false)
    expect(sameDrive(c, { ...c, label: 'Data' })).toBe(false)
    expect(sameDrive(c, { ...c, kind: 'removable' })).toBe(false)
    expect(sameDrive({ path: 'C:\\' }, c)).toBe(false)
    expect(sameDrive(undefined, c)).toBe(false)
  })
})
