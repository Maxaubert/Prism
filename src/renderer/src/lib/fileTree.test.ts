import { describe, expect, it } from 'vitest'
import { ancestorChain, parentDir, toggleExpanded } from './fileTree'

const R = 'C:\\photos'

describe('ancestorChain', () => {
  it('lists the root down to the folder holding the file', () => {
    expect(ancestorChain(R, 'C:\\photos\\2024\\trip\\a.jpg')).toEqual([
      'C:\\photos',
      'C:\\photos\\2024',
      'C:\\photos\\2024\\trip'
    ])
  })

  it('is just the root for a file sitting in it', () => {
    expect(ancestorChain(R, 'C:\\photos\\a.jpg')).toEqual([R])
  })

  it('ignores case differences in the root, as Windows does', () => {
    expect(ancestorChain(R, 'C:\\PHOTOS\\2024\\a.jpg')).toEqual([R, 'C:\\photos\\2024'])
  })

  it('is empty for a path outside the root', () => {
    expect(ancestorChain(R, 'C:\\elsewhere\\a.jpg')).toEqual([])
    expect(ancestorChain(R, 'C:\\photos-old\\a.jpg')).toEqual([])
  })

  it('is empty when either side is missing', () => {
    expect(ancestorChain('', 'C:\\photos\\a.jpg')).toEqual([])
    expect(ancestorChain(R, '')).toEqual([])
  })

  it('handles forward slashes', () => {
    expect(ancestorChain('C:/photos', 'C:/photos/2024/a.jpg')).toEqual(['C:/photos', 'C:/photos/2024'])
  })
})

describe('parentDir', () => {
  it('drops the last segment', () => {
    expect(parentDir('C:\\photos\\2024\\a.jpg')).toBe('C:\\photos\\2024')
    expect(parentDir('C:/photos/a.jpg')).toBe('C:/photos')
  })

  it('returns empty when there is nothing to drop', () => {
    expect(parentDir('a.jpg')).toBe('')
    expect(parentDir('')).toBe('')
  })
})

describe('toggleExpanded', () => {
  it('adds a closed folder and removes an open one', () => {
    const once = toggleExpanded(new Set<string>(), 'C:\\photos\\2024')
    expect([...once]).toEqual(['C:\\photos\\2024'])
    expect([...toggleExpanded(once, 'C:\\photos\\2024')]).toEqual([])
  })

  it('leaves the original set alone', () => {
    const before = new Set(['C:\\photos'])
    toggleExpanded(before, 'C:\\photos\\2024')
    expect([...before]).toEqual(['C:\\photos'])
  })
})
