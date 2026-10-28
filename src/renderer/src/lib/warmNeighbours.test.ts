import { describe, expect, it } from 'vitest'
import { neighbourImages } from './warmNeighbours'

describe('the neighbours worth warming', () => {
  const files = [
    { path: 'a.jpg', kind: 'image', size: 10 },
    { path: 'b.mp4', kind: 'video', size: 10 },
    { path: 'c.jpg', kind: 'image', size: 10 },
    { path: 'd.jpg', kind: 'image', size: 999 },
    { path: 'e.jpg', kind: 'image' }
  ]

  it('takes the images either side, never other kinds', () => {
    expect(neighbourImages(files, 1, 100)).toEqual(['a.jpg', 'c.jpg'])
    expect(neighbourImages(files, 0, 100)).toEqual([])
  })

  it('skips one too big to be worth it, and warms one of unknown size', () => {
    expect(neighbourImages(files, 2, 100)).toEqual([])
    expect(neighbourImages(files, 3, 100)).toEqual(['c.jpg', 'e.jpg'])
  })
})
