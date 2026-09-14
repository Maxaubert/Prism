import { describe, expect, it } from 'vitest'
import { THUMB_WIDTH, thumbArgs, thumbKey, toEvict } from './thumbs'

describe('thumbKey', () => {
  it('is the file, its size and its modified time, case-insensitively, as a jpg name', () => {
    expect(thumbKey('C:\\a.png', 10, 5.7)).toBe(thumbKey('c:\\A.PNG', 10, 5.2))
    expect(thumbKey('C:\\a.png', 10, 5)).not.toBe(thumbKey('C:\\a.png', 11, 5))
    expect(thumbKey('C:\\a.png', 10, 5)).not.toBe(thumbKey('C:\\a.png', 10, 6000))
    expect(thumbKey('C:\\a.png', 10, 5)).toMatch(/^[0-9a-f]{40}\.jpg$/)
  })
})

describe('thumbArgs', () => {
  it('takes one frame scaled to the width, seeking first for a video and not for a still', () => {
    const still = thumbArgs('C:\\a.heic', 'image', 'C:\\t\\x.jpg')
    expect(still).not.toContain('-ss')
    expect(still[still.indexOf('-vf') + 1]).toBe(`scale=${THUMB_WIDTH}:-2`)
    expect(still[still.indexOf('-frames:v') + 1]).toBe('1')
    expect(still[still.length - 1]).toBe('C:\\t\\x.jpg')
    // The format is named, since the file is written under a .part name.
    expect(still[still.indexOf('-f') + 1]).toBe('image2')
    const film = thumbArgs('C:\\a.mkv', 'video', 'C:\\t\\y.jpg')
    expect(film.indexOf('-ss')).toBeLessThan(film.indexOf('-i'))
    expect(film[film.indexOf('-ss') + 1]).toBe('3')
    // The fallback for a clip shorter than the seek: the first frame.
    expect(thumbArgs('C:\\a.mkv', 'video', 'C:\\t\\y.jpg', 0)).not.toContain('-ss')
  })
})

describe('toEvict', () => {
  it('names the oldest until the cache fits, and nothing when it already does', () => {
    const entries = [
      { name: 'new.jpg', size: 40, mtimeMs: 3 },
      { name: 'old.jpg', size: 40, mtimeMs: 1 },
      { name: 'mid.jpg', size: 40, mtimeMs: 2 }
    ]
    expect(toEvict(entries, 200)).toEqual([])
    expect(toEvict(entries, 100)).toEqual(['old.jpg'])
    expect(toEvict(entries, 50)).toEqual(['old.jpg', 'mid.jpg'])
  })
})
