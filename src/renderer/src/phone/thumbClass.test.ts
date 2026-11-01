import { describe, expect, it } from 'vitest'
import { thumbClass } from './thumbClass'

describe('thumbClass (#477: a clear PNG tile was black)', () => {
  it('draws the checker behind a picture that can be clear, once it has arrived', () => {
    expect(thumbClass('C:\\a.png', true).split(' ')).toContain('p-checker')
    expect(thumbClass('C:\\a.png', false).split(' ')).not.toContain('p-checker')
  })
  it('leaves photos and films on the plain ground', () => {
    expect(thumbClass('C:\\a.jpg', true).split(' ')).not.toContain('p-checker')
    expect(thumbClass('C:\\a.mp4', true).split(' ')).not.toContain('p-checker')
  })
})
