import { beforeEach, describe, expect, it } from 'vitest'
import { COLOUR_FORMAT_KEY, colourFormat, cycleColourFormat, setColourFormat } from './colourFormat'

beforeEach(() => localStorage.clear())

describe('the colour format', () => {
  it('opens in HEX', () => {
    expect(colourFormat()).toBe('hex')
  })
  it('reads junk as HEX', () => {
    localStorage.setItem(COLOUR_FORMAT_KEY, 'cmyk')
    expect(colourFormat()).toBe('hex')
  })
  it('remembers a choice', () => {
    setColourFormat('hsla')
    expect(colourFormat()).toBe('hsla')
  })
  it('cycles HEX, RGBA, HSLA and round again', () => {
    expect(cycleColourFormat()).toBe('rgba')
    expect(cycleColourFormat()).toBe('hsla')
    expect(cycleColourFormat()).toBe('hex')
    expect(localStorage.getItem(COLOUR_FORMAT_KEY)).toBe('hex')
  })
})
