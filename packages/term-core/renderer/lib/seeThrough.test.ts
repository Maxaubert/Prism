import { describe, expect, it } from 'vitest'
import { SEE_THROUGH_ALPHA, SEE_THROUGH_MAX, seeThroughAlpha } from './seeThrough'

describe('the default see-through (#156)', () => {
  it("is Prism's two levels as they paint: 0xb9 on dark, 0xd1 on light", () => {
    expect(Math.round(SEE_THROUGH_ALPHA.dark * 255)).toBe(0xb9)
    expect(Math.round(SEE_THROUGH_ALPHA.light * 255)).toBe(0xd1)
    expect(seeThroughAlpha('#0b0b0f')).toBe(SEE_THROUGH_ALPHA.dark)
    expect(seeThroughAlpha('#ffffff')).toBe(SEE_THROUGH_ALPHA.light)
  })
  it('light is measured: relative luminance above 0.4', () => {
    // #aaaaaa is 0.402, #a9a9a9 is 0.397: either side of the edge.
    expect(seeThroughAlpha('#aaaaaa')).toBe(SEE_THROUGH_ALPHA.light)
    expect(seeThroughAlpha('#a9a9a9')).toBe(SEE_THROUGH_ALPHA.dark)
  })
  it('a see-through colour reads by its own opaque colour, not its composite', () => {
    expect(seeThroughAlpha('#ffffff20')).toBe(SEE_THROUGH_ALPHA.light)
    expect(seeThroughAlpha('#00000020')).toBe(SEE_THROUGH_ALPHA.dark)
  })
  it('an unparseable ground reads as dark', () => {
    expect(seeThroughAlpha('soup')).toBe(SEE_THROUGH_ALPHA.dark)
  })
  it("the cap sits below opaque and above both defaults, so Alpha and the switch agree", () => {
    expect(Math.round(SEE_THROUGH_MAX * 255)).toBe(0xf2)
    expect(SEE_THROUGH_MAX).toBeGreaterThan(SEE_THROUGH_ALPHA.light)
    expect(SEE_THROUGH_MAX).toBeLessThan(1)
  })
})
