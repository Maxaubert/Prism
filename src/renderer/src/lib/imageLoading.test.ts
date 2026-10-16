import { describe, expect, it } from 'vitest'
import { imageStillLoading } from './imageLoading'

describe('the image spinner (review, 2026-10-16)', () => {
  const small = { id: 'small' }
  const huge = { id: 'huge' }

  it('shows on the very first load', () => {
    expect(imageStillLoading(false, false, null, null)).toBe(true)
  })

  it('shows while a huge picture decodes, though the one before had loaded', () => {
    expect(imageStillLoading(true, true, huge, null)).toBe(true)
    expect(imageStillLoading(true, true, huge, { id: 'older huge' })).toBe(true)
  })

  it('goes once the huge bitmap is painted', () => {
    expect(imageStillLoading(true, true, huge, huge)).toBe(false)
  })

  it('stays off between ordinary pictures, so the one on screen never fades', () => {
    expect(imageStillLoading(true, false, small, null)).toBe(false)
  })
})
