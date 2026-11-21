import { describe, expect, it } from 'vitest'
import { previewClass } from './previewWindowLook'

describe('previewClass (audit #60)', () => {
  it('keeps the page classes and drops the overlay-scrollbar one', () => {
    expect(previewClass('dark p-overlay-scrollbars p-glass')).toBe('dark p-glass')
    expect(previewClass('p-overlay-scrollbars')).toBe('')
    expect(previewClass('dark')).toBe('dark')
  })
})