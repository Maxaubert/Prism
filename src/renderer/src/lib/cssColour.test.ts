import { describe, expect, it } from 'vitest'
import { cssColour } from './cssColour'

describe('cssColour', () => {
  it('reads rgb() and rgba()', () => {
    expect(cssColour('rgb(1, 2, 3)')).toEqual([1, 2, 3, 255])
    expect(cssColour('rgba(1, 2, 3, 0.16)')).toEqual([1, 2, 3, 41])
    expect(cssColour('rgba(255, 128, 0, 0)')).toEqual([255, 128, 0, 0])
    expect(cssColour('rgba(255, 128, 0, 1)')).toEqual([255, 128, 0, 255])
    expect(cssColour('rgb(1 2 3 / 50%)')).toEqual([1, 2, 3, 128])
  })

  it('reads color(srgb ...), how Chromium serialises color-mix', () => {
    expect(cssColour('color(srgb 0.1 0.2 0.3 / 0.16)')).toEqual([26, 51, 77, 41])
    expect(cssColour('color(srgb 1 0 0.5)')).toEqual([255, 0, 128, 255])
    expect(cssColour('color(srgb 0.4 0.5 0.6 / 0)')).toEqual([102, 128, 153, 0])
    expect(cssColour('color(srgb 1.2 -0.1 0.5 / 1)')).toEqual([255, 0, 128, 255])
  })

  it('reads transparent', () => {
    expect(cssColour('transparent')).toEqual([0, 0, 0, 0])
  })

  it('returns null for anything else', () => {
    expect(cssColour('')).toBeNull()
    expect(cssColour('red')).toBeNull()
    expect(cssColour('#ff0000')).toBeNull()
    expect(cssColour('rgb(1, 2)')).toBeNull()
    expect(cssColour('color(display-p3 0.1 0.2 0.3)')).toBeNull()
    expect(cssColour('rgb(1, 2, 3, 4, 5)')).toBeNull()
    expect(cssColour('rgb(a, b, c)')).toBeNull()
  })
})
