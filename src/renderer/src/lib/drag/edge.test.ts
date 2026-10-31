import { describe, expect, it } from 'vitest'
import { pointerOut } from './edge'

describe('the window edge (#103)', () => {
  it('a pointer past any edge is out', () => {
    expect(pointerOut(-20, 100, 800, 600)).toBe(true)
    expect(pointerOut(100, -1, 800, 600)).toBe(true)
    expect(pointerOut(900, 100, 800, 600)).toBe(true)
    expect(pointerOut(100, 650, 800, 600)).toBe(true)
  })

  it('the last 2 px inside count as out (a maximized window has no outside)', () => {
    expect(pointerOut(0, 300, 800, 600)).toBe(true)
    expect(pointerOut(1, 300, 800, 600)).toBe(true)
    expect(pointerOut(799, 300, 800, 600)).toBe(true)
    expect(pointerOut(798, 300, 800, 600)).toBe(true)
    expect(pointerOut(400, 599, 800, 600)).toBe(true)
  })

  it('anywhere else is in, and a window with no size is never out', () => {
    expect(pointerOut(2, 2, 800, 600)).toBe(false)
    expect(pointerOut(797, 597, 800, 600)).toBe(false)
    expect(pointerOut(400, 300, 800, 600)).toBe(false)
    expect(pointerOut(-5, -5, 0, 0)).toBe(false)
  })
})
