import { describe, expect, it } from 'vitest'
import { saveCopyNote } from './saveCopyNote'

describe('saveCopyNote (#78)', () => {
  it('names the file that was saved', () => {
    expect(saveCopyNote({ saved: 'C:\\pics\\IMG_0412.jpg' })).toBe('Saved IMG_0412.jpg')
    expect(saveCopyNote({ saved: 'D:/out/a b.png' })).toBe('Saved a b.png')
  })

  it('a failure says so; a cancel says nothing', () => {
    expect(saveCopyNote({ failed: true })).toBe('Could not save the copy')
    expect(saveCopyNote({ failed: true, reason: 'source' })).toBe('A copy cannot replace the original')
    expect(saveCopyNote({ canceled: true })).toBeNull()
  })
})
