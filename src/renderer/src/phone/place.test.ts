import { describe, expect, it } from 'vitest'
import { placeUrl, readPlace } from './place'

/** What the browser would hand `readPlace` after a `replaceState` of `url`. */
const searchOf = (url: string): string => new URL(url, 'http://phone/').search

describe('place', () => {
  it('is the root with nothing open when the URL says nothing', () => {
    expect(readPlace('', 'C:\\r')).toEqual({ dir: 'C:\\r', file: null })
    expect(readPlace('?t=abc', 'C:\\r')).toEqual({ dir: 'C:\\r', file: null })
  })

  it('comes back to the folder that was being browsed', () => {
    expect(readPlace('?at=C%3A%5Cr%5Ca%5Cb', 'C:\\r')).toEqual({ dir: 'C:\\r\\a\\b', file: null })
  })

  it('comes back to the file, in the folder that holds it', () => {
    expect(readPlace('?open=C%3A%5Cr%5Ca%5CFilm.mkv', 'C:\\r')).toEqual({
      dir: 'C:\\r\\a',
      file: 'C:\\r\\a\\Film.mkv'
    })
  })

  it('falls back to the root rather than to an error when the place is outside it', () => {
    // The phone moved to another tab (#107), so the place in the URL belongs
    // to a root it is no longer on. It is dropped, not refused.
    expect(readPlace('?at=C%3A%5Cother', 'C:\\r')).toEqual({ dir: 'C:\\r', file: null })
    expect(readPlace('?open=C%3A%5Cother%5CFilm.mkv', 'C:\\r')).toEqual({
      dir: 'C:\\r',
      file: null
    })
    // A path that only LOOKS like the root's is outside it: "C:\roots" is not
    // in "C:\r", and a plain startsWith would have said it was.
    expect(readPlace('?at=C%3A%5Croots', 'C:\\r')).toEqual({ dir: 'C:\\r', file: null })
  })

  it('reads a root the PC spells differently as the same root', () => {
    expect(readPlace('?at=C%3A%5CR%5Ca', 'c:\\r\\')).toEqual({ dir: 'C:\\R\\a', file: null })
  })

  it('writes nothing at all for the root with nothing open', () => {
    expect(placeUrl('C:\\r', { dir: 'C:\\r', file: null })).toBe('/')
    expect(placeUrl('C:\\r', { dir: 'C:\\r\\', file: null })).toBe('/')
  })

  it('writes the folder, and the FILE when one is open', () => {
    expect(placeUrl('C:\\r', { dir: 'C:\\r\\a', file: null })).toBe('/?at=C%3A%5Cr%5Ca')
    // One place, never two: a file IS where you are, and its folder is the
    // one holding it, so writing both would leave a folder in the URL that
    // reading it back can never use.
    expect(placeUrl('C:\\r', { dir: 'C:\\r\\a', file: 'C:\\r\\b\\Film.mkv' })).toBe(
      '/?open=C%3A%5Cr%5Cb%5CFilm.mkv'
    )
  })

  it('reads back what it wrote', () => {
    const root = 'C:\\r'
    for (const place of [
      { dir: 'C:\\r', file: null },
      { dir: 'C:\\r\\holiday 2024', file: null },
      { dir: 'C:\\r\\a', file: 'C:\\r\\a\\Film #1 & co.mkv' }
    ]) {
      expect(readPlace(searchOf(placeUrl(root, place)), root)).toEqual(place)
    }
  })
})
