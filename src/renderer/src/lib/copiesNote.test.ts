import { describe, expect, it } from 'vitest'
import { copiesNote } from './copiesNote'

const r = (saved: number, failed = 0, skipped = 0, canceled = false): Parameters<typeof copiesNote>[0] => ({
  saved: Array.from({ length: saved }, (_, i) => `C:\\p\\${i}.jpg`),
  failed,
  skipped,
  canceled
})

describe('the done note of Save copies as (#474)', () => {
  it('says how many landed', () => {
    expect(copiesNote(r(37))).toBe('Saved 37 copies')
    expect(copiesNote(r(1))).toBe('Saved 1 copy')
  })
  it('in the owner\'s words when some could not be made', () => {
    expect(copiesNote(r(37, 2))).toBe('Saved 37 copies, 2 could not be read')
    expect(copiesNote(r(0, 1))).toBe('No copies saved, 1 could not be read')
  })
  it('says what was skipped for not being a picture', () => {
    expect(copiesNote(r(3, 0, 2))).toBe('Saved 3 copies, 2 skipped (not pictures)')
    expect(copiesNote(r(3, 1, 1))).toBe('Saved 3 copies, 1 could not be read, 1 skipped (not pictures)')
  })
  it('a Cancel says it stopped, and what it had saved', () => {
    expect(copiesNote(r(5, 0, 0, true))).toBe('Stopped, saved 5 copies')
    expect(copiesNote(r(0, 0, 0, true))).toBe('Stopped, no copies saved')
  })
})
