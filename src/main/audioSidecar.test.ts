import { describe, expect, it } from 'vitest'
import { BYTES_PER_SEC } from './ffmpeg'
import { MAX_PAD_BYTES, shortfall } from './audioSidecar'

describe('shortfall: when ffmpeg ends before the promised length (audit #14)', () => {
  it('says nothing when the whole range came', () => {
    expect(shortfall(0)).toBe('none')
  })
  it('pads a frame or two, and up to a second', () => {
    expect(shortfall(4)).toBe('pad')
    expect(shortfall(MAX_PAD_BYTES)).toBe('pad')
    expect(MAX_PAD_BYTES).toBe(BYTES_PER_SEC)
  })
  it('errors on a long gap instead of allocating it as zeros', () => {
    expect(shortfall(MAX_PAD_BYTES + 1)).toBe('error')
    expect(shortfall(1_380_000_000)).toBe('error')
  })
})