import { describe, expect, it } from 'vitest'
import { mayApplyResume, positionToSave, resumeAt } from './resumePoint'

describe('mayApplyResume (audit #91)', () => {
  it('applies a place to the file it was asked for, at its start', () => {
    expect(mayApplyResume(1234, 0, 'a.mkv', 'a.mkv')).toBe(true)
  })
  it('never applies film A place to film B on the reused element', () => {
    expect(mayApplyResume(1234, 0, 'a.mkv', 'b.mkv')).toBe(false)
  })
  it('keeps the old rules: nothing stored, or the film already moved on', () => {
    expect(mayApplyResume(null, 0, 'a.mkv', 'a.mkv')).toBe(false)
    expect(mayApplyResume(1234, 30, 'a.mkv', 'a.mkv')).toBe(false)
  })
})

describe('resumeAt', () => {
  it('goes back to a place inside a long film, and nowhere else', () => {
    expect(resumeAt(1234, 7200)).toBe(1234)
    expect(resumeAt(null, 7200)).toBeNull()
    expect(resumeAt(0, 7200)).toBeNull()
    expect(resumeAt(30, 300)).toBeNull() // a short clip always starts at the start
    expect(resumeAt(7198, 7200)).toBeNull() // inside the credits: watched
    expect(resumeAt(100, NaN)).toBeNull()
  })
})

describe('positionToSave', () => {
  it('writes whole seconds for long media, clears near the end, and never touches a short clip', () => {
    expect(positionToSave(12.7, 7200)).toBe(12)
    expect(positionToSave(7199, 7200)).toBeNull()
    expect(positionToSave(12, 300)).toBeUndefined()
    expect(positionToSave(12, NaN)).toBeUndefined()
  })
})
