import { describe, expect, it } from 'vitest'
import { isFullscreenKey } from './fullscreenKey'

const key = (k: string, mods: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods
})

describe('isFullscreenKey', () => {
  it('is the bare F, either case', () => {
    expect(isFullscreenKey(key('f'))).toBe(true)
    expect(isFullscreenKey(key('F'))).toBe(true)
  })
  it('is never Ctrl+F, which is find (owner, 2026-11-04)', () => {
    expect(isFullscreenKey(key('f', { ctrlKey: true }))).toBe(false)
    expect(isFullscreenKey(key('F', { ctrlKey: true }))).toBe(false)
  })
  it('is never a chord with Alt or Meta either', () => {
    expect(isFullscreenKey(key('f', { altKey: true }))).toBe(false)
    expect(isFullscreenKey(key('f', { metaKey: true }))).toBe(false)
  })
  it('is no other key', () => {
    expect(isFullscreenKey(key('g'))).toBe(false)
    expect(isFullscreenKey(key('F11'))).toBe(false)
  })
})
