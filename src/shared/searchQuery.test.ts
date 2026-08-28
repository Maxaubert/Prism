import { describe, expect, it } from 'vitest'
import { globToRegExp, matchesQuery, parseQuery, tokenize } from './searchQuery'

const finds = (query: string, name: string): boolean => matchesQuery(name, parseQuery(query))

describe('reading a search query', () => {
  it('splits on spaces and keeps quoted phrases whole', () => {
    expect(tokenize('holiday 2024')).toEqual(['holiday', '2024'])
    expect(tokenize('"family dinner" raw')).toEqual(['family dinner', 'raw'])
    expect(tokenize('   ')).toEqual([])
  })

  it('reads the operators apart from plain words', () => {
    expect(parseQuery('*.mp4')).toEqual([{ kind: 'glob', value: '*.mp4', negated: false }])
    expect(parseQuery('ext:MP4')).toEqual([{ kind: 'ext', value: 'mp4', negated: false }])
    expect(parseQuery('ext:.mkv')).toEqual([{ kind: 'ext', value: 'mkv', negated: false }])
    expect(parseQuery('-raw')).toEqual([{ kind: 'text', value: 'raw', negated: true }])
  })
})

describe('every word, in any order', () => {
  it('finds a file whose words are the other way round', () => {
    expect(finds('holiday 2024', '2024-06 holiday.jpg')).toBe(true)
    expect(finds('2024 holiday', '2024-06 holiday.jpg')).toBe(true)
  })

  it('needs ALL of them, not any', () => {
    expect(finds('holiday 2025', '2024-06 holiday.jpg')).toBe(false)
  })

  it('ignores case, as a search box should', () => {
    expect(finds('HOLIDAY', 'Holiday.JPG')).toBe(true)
  })

  it('keeps a quoted phrase together, spaces and all', () => {
    expect(finds('"family dinner"', 'family dinner.mp4')).toBe(true)
    expect(finds('"family dinner"', 'family - dinner.mp4')).toBe(false)
  })
})

describe('globs', () => {
  it('finds every file of a kind', () => {
    expect(finds('*.mp4', 'trip.mp4')).toBe(true)
    expect(finds('*.mp4', 'trip.mkv')).toBe(false)
    expect(finds('*.mp4', 'mp4-notes.txt')).toBe(false)
  })

  it('anchors the pattern, so a glob is not a substring', () => {
    expect(finds('img_*', 'img_001.jpg')).toBe(true)
    expect(finds('img_*', 'my img_001.jpg')).toBe(false)
  })

  it('matches a single character with ?', () => {
    expect(finds('img_??.jpg', 'img_01.jpg')).toBe(true)
    expect(finds('img_??.jpg', 'img_001.jpg')).toBe(false)
  })

  it('takes a dot literally, so *.mp4 is not *xmp4', () => {
    expect(globToRegExp('*.mp4').test('axmp4')).toBe(false)
  })

  it('leaves a quoted star alone: it is a name, not a pattern', () => {
    expect(finds('"2 * 3"', '2 * 3.txt')).toBe(true)
  })
})

describe('ext: and exclusion', () => {
  it('matches the real extension only', () => {
    expect(finds('ext:mp4', 'trip.mp4')).toBe(true)
    expect(finds('ext:mp4', 'trip.mp4.bak')).toBe(false)
  })

  it('combines with words the way people expect', () => {
    expect(finds('holiday ext:mp4', '2024 holiday.mp4')).toBe(true)
    expect(finds('holiday ext:mp4', '2024 holiday.jpg')).toBe(false)
  })

  it('drops what a minus names', () => {
    expect(finds('holiday -raw', 'holiday.jpg')).toBe(true)
    expect(finds('holiday -raw', 'holiday raw.jpg')).toBe(false)
    expect(finds('*.jpg -thumb', 'a thumb.jpg')).toBe(false)
  })

  it('refuses to be only exclusions: that is a listing with a hole in it', () => {
    expect(finds('-raw', 'holiday.jpg')).toBe(false)
  })
})

describe('the boring cases', () => {
  it('an empty query matches nothing', () => {
    expect(finds('', 'anything.jpg')).toBe(false)
    expect(finds('   ', 'anything.jpg')).toBe(false)
  })

  it('a bare .mp4 stays a plain substring, on purpose', () => {
    expect(finds('.mp4', 'trip.mp4')).toBe(true)
    expect(finds('.mp4', 'photo.mp4.bak')).toBe(true)
  })
})
