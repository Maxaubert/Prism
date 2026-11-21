import { describe, expect, it } from 'vitest'
import { archiveCopyNote } from './archiveCopyNote'

describe('archiveCopyNote (audit #32)', () => {
  it('says nothing when everything came out', () => {
    expect(archiveCopyNote(0, 0)).toBeNull()
  })
  it('keeps the password line', () => {
    expect(archiveCopyNote(1, 0)).toBe(
      '1 of those is password protected. Open one first to unlock the archive, then copy again.'
    )
  })
  it('says the others failed, with main`s reason', () => {
    expect(archiveCopyNote(0, 2, 'Disk is full.')).toBe("2 of those couldn't be copied. Disk is full.")
    expect(archiveCopyNote(0, 1)).toBe("1 of those couldn't be copied.")
  })
})