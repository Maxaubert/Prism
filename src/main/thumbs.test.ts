import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import { CacheBudget, THUMB_WIDTH, isThumbFile, thumbArgs, thumbKey, toEvict } from './thumbs'

describe('CacheBudget (2026-10-16: every thumbnail stat-scanned the whole cache)', () => {
  it('scans once to learn the total, then only past the ceiling', () => {
    const b = new CacheBudget(100)
    expect(b.add(10)).toBe(true) // the total is unknown: learn it
    b.settled(50)
    expect(b.add(20)).toBe(false) // 70
    expect(b.add(30)).toBe(false) // 100, at the ceiling
    expect(b.add(1)).toBe(true) // 101: over
  })

  it('never starts a second scan while one runs', () => {
    const b = new CacheBudget(100)
    expect(b.add(10)).toBe(true)
    expect(b.add(10)).toBe(false)
    expect(b.add(10)).toBe(false)
    b.settled(90)
    expect(b.add(5)).toBe(false)
  })

  it('a scan that failed leaves the total unknown, so the next thumbnail scans again', () => {
    const b = new CacheBudget(100)
    expect(b.add(10)).toBe(true)
    b.settled(null)
    expect(b.add(10)).toBe(true)
  })
})

describe('thumbKey', () => {
  it('is the file, its size and its modified time, case-insensitively, as a jpg name', () => {
    expect(thumbKey('C:\\a.png', 10, 5.7)).toBe(thumbKey('c:\\A.PNG', 10, 5.2))
    expect(thumbKey('C:\\a.png', 10, 5)).not.toBe(thumbKey('C:\\a.png', 11, 5))
    expect(thumbKey('C:\\a.png', 10, 5)).not.toBe(thumbKey('C:\\a.png', 10, 6000))
    expect(thumbKey('C:\\a.jpg', 10, 5)).toMatch(/^[0-9a-f]{40}\.jpg$/)
  })

  it('names a picture that can be clear a .webp, so the black JPEGs made before #477 are not served again', () => {
    expect(thumbKey('C:\\a.png', 10, 5)).toMatch(/^[0-9a-f]{40}\.webp$/)
    expect(thumbKey('C:\\a.gif', 10, 5)).toMatch(/^[0-9a-f]{40}\.webp$/)
    expect(thumbKey('C:\\a.heic', 10, 5)).toMatch(/^[0-9a-f]{40}\.jpg$/)
    expect(thumbKey('C:\\a.mp4', 10, 5)).toMatch(/^[0-9a-f]{40}\.jpg$/)
    // A photo's key is the one it always had: its cached JPEG stays good.
    expect(thumbKey('C:\\a.jpg', 10, 5)).toBe(createHash('sha1').update('c:\\a.jpg|10|5').digest('hex') + '.jpg')
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

  it('keeps the alpha of a picture that can be clear: a WebP, never a JPEG (#477)', () => {
    const png = thumbArgs('C:\\a.png', 'image', 'C:\\t\\x.webp.part')
    expect(png[png.indexOf('-c:v') + 1]).toBe('libwebp')
    expect(png[png.indexOf('-f') + 1]).toBe('webp')
    expect(png).not.toContain('-q:v')
    expect(png[png.indexOf('-vf') + 1]).toBe(`scale=${THUMB_WIDTH}:-2`)
    const photo = thumbArgs('C:\\a.jpg', 'image', 'C:\\t\\x.jpg.part')
    expect(photo).not.toContain('libwebp')
    expect(photo[photo.indexOf('-f') + 1]).toBe('image2')
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

describe('isThumbFile', () => {
  it('counts both kinds of thumbnail and nothing half-written', () => {
    expect(isThumbFile('a.jpg')).toBe(true)
    expect(isThumbFile('a.webp')).toBe(true)
    expect(isThumbFile('a.webp.part')).toBe(false)
    expect(isThumbFile('a.txt')).toBe(false)
  })
})
