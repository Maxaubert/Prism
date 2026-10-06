import { describe, expect, it } from 'vitest'
import { markedPlace, withinFolder } from './placeMark'

describe('withinFolder', () => {
  it('is the folder itself or beneath it, whatever the case and slashes', () => {
    expect(withinFolder('C:\\Code', 'c:\\code\\')).toBe(true)
    expect(withinFolder('C:\\Code\\app\\src', 'C:/Code')).toBe(true)
    expect(withinFolder('C:\\Codex', 'C:\\Code')).toBe(false)
    expect(withinFolder('D:\\Code', 'C:\\Code')).toBe(false)
  })
  it('a drive root holds everything on its drive', () => {
    expect(withinFolder('C:\\Users\\me', 'C:\\')).toBe(true)
    expect(withinFolder('C:\\', 'C:\\')).toBe(true)
    expect(withinFolder('D:\\x', 'C:\\')).toBe(false)
  })
})

describe('markedPlace', () => {
  const rows = [
    { row: 'pin:C:\\Code', path: 'C:\\Code' },
    { row: 'pin:C:\\Users\\me\\AppData', path: 'C:\\Users\\me\\AppData' },
    { row: 'place:C:\\Code', path: 'C:\\Code' },
    { row: 'place:C:\\', path: 'C:\\' }
  ]
  it('with nothing clicked, the first place whose path IS the folder', () => {
    expect(markedPlace(rows, 'c:\\code', null)).toBe('pin:C:\\Code')
    expect(markedPlace(rows, 'C:\\', null)).toBe('place:C:\\')
    expect(markedPlace(rows, 'C:\\Code\\src', null)).toBe(null)
  })
  it('the clicked place stays marked in its subfolders, and wins a shared path', () => {
    const project = rows[2]
    expect(markedPlace(rows, 'C:\\Code', project)).toBe('place:C:\\Code')
    expect(markedPlace(rows, 'C:\\Code\\src\\lib', project)).toBe('place:C:\\Code')
    expect(markedPlace(rows, 'C:\\Users\\me\\AppData\\Local', rows[1])).toBe(
      'pin:C:\\Users\\me\\AppData'
    )
  })
  it('outside the clicked place it falls back to an exact match, else none', () => {
    expect(markedPlace(rows, 'C:\\Users\\me\\AppData', rows[2])).toBe('pin:C:\\Users\\me\\AppData')
    expect(markedPlace(rows, 'D:\\x', rows[2])).toBe(null)
  })
  it('a drive clicked stays marked anywhere on it, a pinned folder there included', () => {
    expect(markedPlace(rows, 'C:\\Windows', rows[3])).toBe('place:C:\\')
    expect(markedPlace(rows, 'C:\\Code', rows[3])).toBe('place:C:\\')
  })
  it('a clicked row that is gone (unpinned) gives way', () => {
    expect(markedPlace(rows, 'C:\\Code', { row: 'pin:C:\\Old', path: 'C:\\Code' })).toBe('pin:C:\\Code')
  })
})
