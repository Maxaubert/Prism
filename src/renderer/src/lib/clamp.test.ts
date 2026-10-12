import { describe, expect, it } from 'vitest'
import { clamp } from './clamp'

describe('clamp', () => {
  it('holds a value within the range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
  it('lets the floor win when the range is empty', () => {
    expect(clamp(2, 1, 0)).toBe(1)
    expect(clamp(0, 1, 0)).toBe(1)
  })
})
