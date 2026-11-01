import { describe, expect, it } from 'vitest'
import { COPY_FORMATS, canCopyImage, copyExt, copyLabel, isCopyFormat, mainEncodes } from './imageCopy'

describe('the copy formats (#474)', () => {
  it('both menus offer the same five, in this order', () => {
    expect(COPY_FORMATS.map((f) => f.label)).toEqual(['JPEG', 'PNG', 'WebP', 'AVIF', 'JPEG XL'])
    expect(COPY_FORMATS.map((f) => copyExt(f.format))).toEqual(['jpg', 'png', 'webp', 'avif', 'jxl'])
    expect(copyLabel('jxl')).toBe('JPEG XL')
  })

  it('knows a format from anything else the page might send', () => {
    for (const f of ['jpeg', 'png', 'webp', 'avif', 'jxl']) expect(isCopyFormat(f)).toBe(true)
    for (const f of ['jpg', 'gif', '', null, 3, 'JPEG']) expect(isCopyFormat(f)).toBe(false)
  })

  it('the canvas makes JPEG and PNG; main makes the rest with ffmpeg', () => {
    expect(COPY_FORMATS.filter((f) => mainEncodes(f.format)).map((f) => f.format)).toEqual(['webp', 'avif', 'jxl'])
  })

  it('a copy is made of a picture, not a drawing or anything else', () => {
    for (const p of ['C:\\a\\IMG_0412.HEIC', 'C:\\a\\b.jpg', 'C:\\a\\c.CR2', 'C:\\a\\d.png', 'C:\\a\\e.psd', 'C:\\a\\f.gif'])
      expect(canCopyImage(p)).toBe(true)
    // ffmpeg cannot draw an SVG (no librsvg in the bundle): skipped, not failed.
    for (const p of ['C:\\a\\logo.svg', 'C:\\a\\notes.txt', 'C:\\a\\clip.mp4', 'C:\\a\\folder', 'C:\\a\\b.zip'])
      expect(canCopyImage(p)).toBe(false)
  })
})
