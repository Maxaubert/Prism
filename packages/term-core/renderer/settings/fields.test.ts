import { describe, expect, it } from 'vitest'
import { colourCommit } from '../lib/colour'

// Code review 2026-09-24, #26: tabbing through a colour that follows the theme
// must not make it a colour of your own. The rule is colourCommit's (#112);
// with alpha off, a typed alpha commits as the opaque colour, or as nothing.
describe('colourCommit without alpha', () => {
  it('commits nothing when nothing was typed, or the same colour was', () => {
    expect(colourCommit(null, '#aabbcc', { alpha: false })).toBeNull()
    expect(colourCommit('ABC', '#aabbcc', { alpha: false })).toBeNull()
    expect(colourCommit('#AABBCC', '#aabbcc', { alpha: false })).toBeNull()
  })
  it('commits a new colour, normalised, and nothing for a non-colour', () => {
    expect(colourCommit('123', '#aabbcc', { alpha: false })).toBe('#112233')
    expect(colourCommit('zz', '#aabbcc', { alpha: false })).toBeNull()
  })
  it('a typed alpha commits as the opaque colour, or as nothing', () => {
    expect(colourCommit('#11223380', '#aabbcc', { alpha: false })).toBe('#112233')
    expect(colourCommit('rgba(170, 187, 204, 0.5)', '#aabbcc', { alpha: false })).toBeNull()
  })
})
