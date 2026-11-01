import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { photoInfoPref } from './photoInfoPref'

describe('photoInfoPref (#78, D5: remembered across launches)', () => {
  beforeEach(() => {
    localStorage.clear()
    photoInfoPref.reload()
  })
  afterEach(() => vi.restoreAllMocks())

  it('is off until somebody turns it on', () => {
    expect(photoInfoPref.get()).toBe(false)
  })

  it('is stored, and read back as a fresh launch would', () => {
    photoInfoPref.set(true)
    expect(localStorage.getItem('prism.photoInfo')).toBe('1')
    photoInfoPref.reload()
    expect(photoInfoPref.get()).toBe(true)
    photoInfoPref.set(false)
    photoInfoPref.reload()
    expect(photoInfoPref.get()).toBe(false)
  })

  it('a store that throws reads as off, and a write to it does not throw', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    photoInfoPref.reload()
    expect(photoInfoPref.get()).toBe(false)
    expect(() => photoInfoPref.set(true)).not.toThrow()
  })
})
