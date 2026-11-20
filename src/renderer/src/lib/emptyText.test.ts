import { describe, expect, it } from 'vitest'
import { contents, count, EMPTY_ARCHIVE, EMPTY_FOLDER, NO_MATCHES, NO_MATCHES_STOPPED, plural } from './emptyText'

describe('count', () => {
  it('always groups thousands with commas, whatever the machine locale', () => {
    expect(count(0)).toBe('0')
    expect(count(999)).toBe('999')
    expect(count(12000)).toBe('12,000')
    expect(count(1234567)).toBe('1,234,567')
    expect(count(2.6)).toBe('3')
  })
})

describe('plural', () => {
  it('says one of a thing without the s, and counts the rest with separators', () => {
    expect(plural(1, 'item')).toBe('1 item')
    expect(plural(0, 'item')).toBe('0 items')
    expect(plural(12000, 'item')).toBe('12,000 items')
    expect(plural(2, 'match', 'matches')).toBe('2 matches')
    expect(plural(1, 'match', 'matches')).toBe('1 match')
  })
})

describe('contents', () => {
  it('puts files before folders and leaves out no folders', () => {
    expect(contents(3, 0)).toBe('3 files')
    expect(contents(1, 1)).toBe('1 file, 1 folder')
    expect(contents(12000, 2)).toBe('12,000 files, 2 folders')
  })
})

describe('the empty strings', () => {
  it('are one wording each', () => {
    expect(NO_MATCHES).toBe('No matching items in this folder or its subfolders.')
    expect(NO_MATCHES_STOPPED).toMatch(/^No matches found before the search stopped/)
    expect(EMPTY_FOLDER).toBe('This folder is empty.')
    expect(EMPTY_ARCHIVE).toBe('This archive is empty.')
  })
})