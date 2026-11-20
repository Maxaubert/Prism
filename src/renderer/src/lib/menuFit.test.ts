import { describe, expect, it } from 'vitest'
import { menuLimits } from './menuFit'

describe('menuLimits (audit #94)', () => {
  it('is the natural size when there is room', () => {
    expect(menuLimits({ top: 700, right: 1000 }, { top: 0, left: 0 }, 800)).toEqual({ maxWidth: 230, maxHeight: 420 })
  })
  it('narrows to the room left of the button in a narrow pane', () => {
    const l = menuLimits({ top: 700, right: 200 }, { top: 0, left: 0 }, 800)
    expect(l.maxWidth).toBe(192)
  })
  it('shortens to the room above the button, and has a floor', () => {
    expect(menuLimits({ top: 200, right: 1000 }, { top: 0, left: 0 }, 800).maxHeight).toBe(156)
    expect(menuLimits({ top: 20, right: 100 }, { top: 0, left: 0 }, 800)).toEqual({ maxWidth: 150, maxHeight: 96 })
  })
})