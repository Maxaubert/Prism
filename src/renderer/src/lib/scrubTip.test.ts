import { describe, expect, it } from 'vitest'
import { tipLeft } from './scrubTip'

describe('tipLeft (audit #69)', () => {
  it('holds the label half its width inside both ends of the bar', () => {
    expect(tipLeft(0)).toBe('clamp(32px, 0%, calc(100% - 32px))')
    expect(tipLeft(1)).toBe('clamp(32px, 100%, calc(100% - 32px))')
  })
  it('follows the pointer in the middle and ignores a fraction out of range', () => {
    expect(tipLeft(0.5)).toBe('clamp(32px, 50%, calc(100% - 32px))')
    expect(tipLeft(-3)).toBe(tipLeft(0))
    expect(tipLeft(7)).toBe(tipLeft(1))
  })
})