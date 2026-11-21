import { describe, expect, it } from 'vitest'
import { seeksOnPress } from './scrubPress'

describe('seeksOnPress (audit #19)', () => {
  it('seeks for the main button only', () => {
    expect(seeksOnPress(0)).toBe(true)
    expect(seeksOnPress(1)).toBe(false)
    expect(seeksOnPress(2)).toBe(false)
  })
})