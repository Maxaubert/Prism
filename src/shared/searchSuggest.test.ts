import { describe, expect, it } from 'vitest'
import { hitFolder, nameRank, plainWords, rankSuggestions, stepActive, SUGGEST_COUNT } from './searchSuggest'

const root = 'C:\\work'
const hit = (path: string, isFolder = false) => ({
  path,
  name: path.split('\\').pop()!,
  isFolder
})

describe('nameRank', () => {
  it('ranks the whole name, then its start, then a word, then anywhere', () => {
    expect(nameRank('notes.txt', 'notes')).toBe(0)
    expect(nameRank('Notes', 'notes')).toBe(0)
    expect(nameRank('notes-2024.md', 'notes')).toBe(1)
    expect(nameRank('old-notes.md', 'notes')).toBe(2)
    expect(nameRank('footnotes.md', 'notes')).toBe(3)
    expect(nameRank('readme.md', 'notes')).toBe(4)
  })
  it('reads every word, in any order, as the search does', () => {
    expect(nameRank('2024-06 holiday.jpg', 'holiday 2024')).toBe(2)
    expect(nameRank('holiday.jpg', 'holiday 2024')).toBe(4)
  })
  it('leaves the operators out of the words', () => {
    expect(plainWords('"two words" ext:mp4 -raw *.jpg folder:music')).toEqual(['two', 'words', 'mp4', 'music'])
    expect(nameRank('anything.mp4', '*.mp4')).toBe(4)
  })
})

describe('rankSuggestions', () => {
  it('puts name matches first and keeps the count', () => {
    const hits = [
      hit('C:\\work\\a\\footnotes.md'),
      hit('C:\\work\\b\\old-notes.md'),
      hit('C:\\work\\notes-2024.md'),
      hit('C:\\work\\deep\\x\\notes.txt'),
      ...Array.from({ length: 20 }, (_, i) => hit(`C:\\work\\f${i}\\notes${i}.log`))
    ]
    const top = rankSuggestions(hits, 'notes', root)
    expect(top).toHaveLength(SUGGEST_COUNT)
    expect(top[0].name).toBe('notes.txt')
    expect(top.map((h) => h.name)).not.toContain('footnotes.md')
  })
  it('prefers the nearer hit, then a folder, then the shorter name', () => {
    const top = rankSuggestions(
      [hit('C:\\work\\a\\b\\docs'), hit('C:\\work\\docs.md'), hit('C:\\work\\docs', true), hit('C:\\work\\a\\docs', true)],
      'docs',
      root
    )
    expect(top.map((h) => h.path)).toEqual(['C:\\work\\docs', 'C:\\work\\docs.md', 'C:\\work\\a\\docs', 'C:\\work\\a\\b\\docs'])
  })
  it('is empty for no hits', () => {
    expect(rankSuggestions([], 'x', root)).toEqual([])
  })
})

describe('hitFolder', () => {
  it('says where a hit lives from the folder you are in', () => {
    expect(hitFolder('C:\\work\\notes.txt', root)).toBe('work')
    expect(hitFolder('C:\\work\\a\\b\\notes.txt', root)).toBe('a\\b')
    expect(hitFolder('C:\\notes.txt', 'C:\\')).toBe('C:')
  })
})

describe('stepActive', () => {
  it('marks nothing until walked, then wraps through the rows and Show more', () => {
    expect(stepActive(-1, 3, 1, true)).toBe(0)
    expect(stepActive(-1, 3, -1, true)).toBe(3)
    expect(stepActive(2, 3, 1, true)).toBe(3)
    expect(stepActive(3, 3, 1, true)).toBe(0)
    expect(stepActive(0, 3, -1, false)).toBe(2)
    expect(stepActive(-1, 0, 1, false)).toBe(-1)
    expect(stepActive(-1, 0, 1, true)).toBe(0)
  })
})
