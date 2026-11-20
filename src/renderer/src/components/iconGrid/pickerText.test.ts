import { describe, expect, it } from 'vitest'
import { iconStatus } from './pickerText'

describe('iconStatus', () => {
  it('counts with separators and the right plural', () => {
    expect(iconStatus(1500, 1500, false)).toBe('1,500 icons')
    expect(iconStatus(1, 1, false)).toBe('1 icon')
    expect(iconStatus(1500, 0, true)).toBe('No icon matches')
    expect(iconStatus(1500, 1, true)).toBe('1 match')
    expect(iconStatus(1500, 1200, true)).toBe('1,200 matches')
  })
})