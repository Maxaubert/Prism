import { describe, expect, it } from 'vitest'
import { imageExtensions } from '@shared/fileKind'
import { mediaMime } from './mime'

/**
 * fsmedia:// types every picture fileKind calls an image (#31).
 *
 * The two used to be separate lists, and they drifted: `.ico` was an image to
 * the viewer and `application/octet-stream` to main, so it missed the
 * whole-buffer fast path that is gated on `image/`. The image half of the
 * table is now built from fileKind, and this test holds the two together.
 */
describe('the media types main serves (#31)', () => {
  it('reads fileKind for the image list', () => {
    // An empty list would make every check below pass on nothing.
    expect(imageExtensions().length).toBeGreaterThan(30)
  })

  it('gives every image extension fileKind lists an image type', () => {
    const untyped = imageExtensions().filter((e) => !mediaMime(`C:/x/a${e}`).startsWith('image/'))
    expect(untyped).toEqual([])
  })

  it('types an icon as one', () => {
    expect(mediaMime('C:/x/favicon.ICO')).toBe('image/x-icon')
  })

  it('types what main converts as the copy it serves', () => {
    expect(mediaMime('C:/x/scan.tiff')).toBe('image/png')
    expect(mediaMime('C:/x/photo.jxl')).toBe('image/png')
    expect(mediaMime('C:/x/phone.heic')).toBe('image/jpeg')
    expect(mediaMime('C:/x/camera.cr2')).toBe('image/jpeg')
  })

  it('keeps the native types', () => {
    expect(mediaMime('C:/x/a.png')).toBe('image/png')
    expect(mediaMime('C:/x/a.jfif')).toBe('image/jpeg')
    expect(mediaMime('C:/x/a.svg')).toBe('image/svg+xml')
    expect(mediaMime('C:/x/a.avif')).toBe('image/avif')
  })

  it('still types media and leaves the unknown as bytes', () => {
    expect(mediaMime('C:/x/a.mp4')).toBe('video/mp4')
    expect(mediaMime('C:/x/a.flac')).toBe('audio/flac')
    expect(mediaMime('C:/x/a.pdf')).toBe('application/pdf')
    expect(mediaMime('C:/x/a.xyz')).toBe('application/octet-stream')
  })
})
