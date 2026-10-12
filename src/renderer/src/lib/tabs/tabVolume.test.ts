import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_VOLUME, forgetTabVolume, setTabRate, setTabVolume, tabRate, tabVolume } from './tabVolume'

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

describe('tab speed (#207)', () => {
  it('starts at 1x, keeps what the tab chose, and is the tab\'s own', () => {
    expect(tabRate('s1')).toBe(1)
    setTabRate('s1', 0.5)
    expect(tabRate('s1')).toBe(0.5)
    expect(tabRate('s2')).toBe(1)
  })

  it('goes with the tab, and refuses nonsense', () => {
    setTabRate('s3', 1.5)
    forgetTabVolume('s3')
    expect(tabRate('s3')).toBe(1)
    setTabRate('s4', 0)
    setTabRate('', 2)
    expect(tabRate('s4')).toBe(1)
    expect(tabRate('')).toBe(1)
  })
})
