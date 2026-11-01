import { describe, expect, it } from 'vitest'
import { imageExtensions } from './fileKind'
import { THUMB_ALPHA_EXTS, thumbKeepsAlpha } from './thumbAlpha'

describe('thumbKeepsAlpha (#477: a transparent PNG tile showed black)', () => {
  it('keeps the clear parts of formats that can have them', () => {
    for (const p of ['C:\\a.png', 'C:\\a.PNG', 'C:\\a.webp', 'C:\\a.gif', 'C:\\a.avif', 'C:\\a.ico', 'C:\\a.tga', 'C:\\a.psd', 'C:\\a.tif']) {
      expect(thumbKeepsAlpha(p), p).toBe(true)
    }
  })

  it('leaves photos, raws and videos as JPEGs, so the cache does not grow for them', () => {
    for (const p of ['C:\\a.jpg', 'C:\\a.jpeg', 'C:\\a.jfif', 'C:\\a.heic', 'C:\\a.cr2', 'C:\\a.dng', 'C:\\a.mp4', 'C:\\a.mkv', 'C:\\a']) {
      expect(thumbKeepsAlpha(p), p).toBe(false)
    }
  })

  it('names only image extensions Prism knows', () => {
    const known = new Set(imageExtensions())
    for (const e of THUMB_ALPHA_EXTS) expect(known.has(e), e).toBe(true)
  })
})
