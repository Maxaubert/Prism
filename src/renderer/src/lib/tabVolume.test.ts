import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_VOLUME, forgetTabVolume, setTabVolume, tabVolume } from './tabVolume'

beforeEach(() => {
  forgetTabVolume('a')
  forgetTabVolume('b')
})

describe('volume per tab', () => {
  it('starts every tab at 100%', () => {
    expect(tabVolume('a')).toEqual({ vol: DEFAULT_VOLUME, muted: false })
    expect(DEFAULT_VOLUME).toBe(1)
  })

  it('keeps a tab at what you set it to', () => {
    setTabVolume('a', { vol: 1.4, muted: false })
    expect(tabVolume('a').vol).toBe(1.4)
  })

  it('keeps tabs apart: a new one is not the last one you turned up', () => {
    setTabVolume('a', { vol: 0.2, muted: true })
    expect(tabVolume('b')).toEqual({ vol: 1, muted: false })
  })

  it('remembers mute alongside the level', () => {
    setTabVolume('a', { vol: 0.6, muted: true })
    expect(tabVolume('a')).toEqual({ vol: 0.6, muted: true })
  })

  it('forgets a tab that has been closed', () => {
    setTabVolume('a', { vol: 1.8, muted: false })
    forgetTabVolume('a')
    expect(tabVolume('a').vol).toBe(1)
  })

  it('ignores a write with no key at all', () => {
    setTabVolume('', { vol: 0.1, muted: true })
    expect(tabVolume('').vol).toBe(1)
  })
})
