import { describe, expect, it } from 'vitest'
import { VIDEO_FITS, fitStyle, type VideoFit } from './videoFit'

describe('the picture-fit modes', () => {
  it('defaults to letterboxing the whole picture', () => {
    expect(fitStyle('fit').className).toContain('object-contain')
  })

  it('crops to fill, rather than squashing, when told to fill', () => {
    expect(fitStyle('fill').className).toContain('object-cover')
  })

  it('squashes only when asked to stretch', () => {
    expect(fitStyle('stretch').className).toContain('object-fill')
  })

  it('forces the shape for a fixed ratio, and keeps it inside the window', () => {
    const r = fitStyle('16:9')
    expect(r.style.aspectRatio).toBe('16 / 9')
    expect(r.className).toContain('max-h-full')
    expect(fitStyle('4:3').style.aspectRatio).toBe('4 / 3')
  })

  it('has a label and an explanation for every mode the menu offers', () => {
    const ids = VIDEO_FITS.map((f) => f.id)
    // Original size was offered and cut: on a 4K file in a small window it
    // shows a corner of the picture, which reads as a bug rather than a mode.
    expect(ids).toEqual(['fit', 'fill', 'stretch', '16:9', '4:3'])
    for (const f of VIDEO_FITS) {
      expect(f.label.length).toBeGreaterThan(1)
      expect(f.hint.endsWith('.')).toBe(true)
      expect(fitStyle(f.id as VideoFit).className.length).toBeGreaterThan(0)
    }
  })
})
