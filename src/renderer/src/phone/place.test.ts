import { describe, expect, it } from 'vitest'
import { placeUrl, readPlace } from './place'

/** What the browser would hand `readPlace` after a `replaceState` of `url`. */
const searchOf = (url: string): string => new URL(url, 'http://phone/').search

describe('place', () => {
  it('is where the PC says the phone left off when the URL says nothing', () => {
    expect(readPlace('', 'C:\\r')).toEqual({ dir: 'C:\\r', file: null })
    expect(readPlace('?t=abc', 'C:\\r')).toEqual({ dir: 'C:\\r', file: null })
    // Nowhere yet, or This PC: the places page.
    expect(readPlace('', null)).toEqual({ dir: '', file: null })
  })

  it('comes back to the folder that was being browsed, anywhere on the PC', () => {
    expect(readPlace('?at=C%3A%5Cr%5Ca%5Cb', 'C:\\r')).toEqual({ dir: 'C:\\r\\a\\b', file: null })
    expect(readPlace('?at=D%3A%5Cfilms', 'C:\\r')).toEqual({ dir: 'D:\\films', file: null })
  })

  it('comes back to the file, in the folder that holds it', () => {
    expect(readPlace('?open=C%3A%5Cr%5Ca%5CFilm.mkv', null)).toEqual({
      dir: 'C:\\r\\a',
      file: 'C:\\r\\a\\Film.mkv'
    })
    // A file at a drive's top is in that drive, not in "C:".
    expect(readPlace('?open=C%3A%5CFilm.mkv', null)).toEqual({ dir: 'C:\\', file: 'C:\\Film.mkv' })
  })

  it('drops a place that is not a local path rather than believing it', () => {
    expect(readPlace('?at=%5C%5Cnas%5Cfilms', 'C:\\r')).toEqual({ dir: 'C:\\r', file: null })
    expect(readPlace('?open=films%5CFilm.mkv', null)).toEqual({ dir: '', file: null })
    expect(readPlace('', '\\\\nas\\films')).toEqual({ dir: '', file: null })
  })

  it('writes nothing at all for This PC with nothing open', () => {
    expect(placeUrl({ dir: '', file: null })).toBe('/')
  })

  it('writes the folder, and the FILE when one is open', () => {
    expect(placeUrl({ dir: 'C:\\r\\a', file: null })).toBe('/?at=C%3A%5Cr%5Ca')
    // One place, never two: a file IS where you are, and its folder is the
    // one holding it, so writing both would leave a folder in the URL that
    // reading it back can never use.
    expect(placeUrl({ dir: 'C:\\r\\a', file: 'C:\\r\\b\\Film.mkv' })).toBe('/?open=C%3A%5Cr%5Cb%5CFilm.mkv')
  })

  it('reads back what it wrote', () => {
    // (This PC writes a bare URL, which reads back as wherever the PC says
    // the phone is; on This PC that is This PC, since showing it says so.)
    for (const place of [
      { dir: 'C:\\r', file: null },
      { dir: 'C:\\r\\holiday 2024', file: null },
      { dir: 'C:\\r\\a', file: 'C:\\r\\a\\Film #1 & co.mkv' }
    ]) {
      expect(readPlace(searchOf(placeUrl(place)), 'D:\\elsewhere')).toEqual(place)
    }
  })
})
