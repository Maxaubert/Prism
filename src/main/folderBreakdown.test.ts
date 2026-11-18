import { describe, expect, it } from 'vitest'
import { breakdownOf, breakdownTarget } from './folderBreakdown'

describe('breakdownTarget', () => {
  it('takes a plain path on a drive, with or without a trailing backslash', () => {
    expect(breakdownTarget('C:\\Users')).toBe('C:\\Users')
    expect(breakdownTarget('C:\\Users\\')).toBe('C:\\Users')
    expect(breakdownTarget('D:\\')).toBe('D:\\')
  })
  it('refuses anything else', () => {
    for (const p of ['C:\\Users\\..\\Windows', 'C:\\a\\.\\b', '\\\\server\\share', '\\\\?\\C:\\x', 'C:/Users', 'Users', '', 42, null, 'C:\\a\0b'])
      expect(breakdownTarget(p)).toBeNull()
  })
})

describe('breakdownOf', () => {
  const sizes = new Map([
    ['C:\\Users', { bytes: 1000 }],
    ['C:\\Users\\Admin', { bytes: 700 }],
    ['C:\\Users\\Public', { bytes: 200 }]
  ])
  it('lists the folders biggest first, and the files directly in it are the rest', () => {
    expect(breakdownOf('C:\\Users', ['C:\\Users\\Public', 'C:\\Users\\Admin', 'C:\\Users\\Gone'], sizes)).toEqual({
      bytes: 1000,
      files: 100,
      folders: [
        { path: 'C:\\Users\\Admin', name: 'Admin', bytes: 700 },
        { path: 'C:\\Users\\Public', name: 'Public', bytes: 200 }
      ]
    })
  })
  it('never makes the whole smaller than its folders', () => {
    const over = new Map([...sizes, ['C:\\Users', { bytes: 500 }]])
    expect(breakdownOf('C:\\Users', ['C:\\Users\\Admin', 'C:\\Users\\Public'], over)).toMatchObject({ bytes: 900, files: 0 })
  })
  it('a folder with no folders is all files', () => {
    expect(breakdownOf('C:\\Users\\Admin', [], sizes)).toEqual({ bytes: 700, files: 700, folders: [] })
  })
  it('is null when the index could not answer, or knows nothing of it', () => {
    expect(breakdownOf('C:\\Users', ['C:\\Users\\Admin'], null)).toBeNull()
    expect(breakdownOf('C:\\Nope', [], sizes)).toBeNull()
  })
})
