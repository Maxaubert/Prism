import { beforeEach, describe, expect, it } from 'vitest'
import { forgetPaused, rememberPaused, rememberTime, sessionTime, wasPaused } from './playState'

beforeEach(() => {
  forgetPaused('a')
  forgetPaused('b')
})

describe('what the player remembers across a remount', () => {
  it('knows a file you paused', () => {
    rememberPaused('a', true)
    expect(wasPaused('a')).toBe(true)
  })

  it('forgets it the moment you press play again', () => {
    rememberPaused('a', true)
    rememberPaused('a', false)
    expect(wasPaused('a')).toBe(false)
  })

  it('says nothing about a file it has never seen', () => {
    // A fresh open must PLAY: that is what opening a file means.
    expect(wasPaused('never-seen')).toBe(false)
  })

  it('keeps files apart', () => {
    rememberPaused('a', true)
    expect(wasPaused('b')).toBe(false)
  })

  it('ignores an empty key rather than remembering "nothing"', () => {
    rememberPaused('', true)
    expect(wasPaused('')).toBe(false)
  })
})

describe('session position', () => {
  it('remembers where a file had got to', () => {
    rememberTime('a', 127.5)
    expect(sessionTime('a')).toBe(127.5)
  })

  it('is 0 for a file this session has not seen', () => {
    expect(sessionTime('never-seen')).toBe(0)
  })

  it('keeps the paused flag and the position apart', () => {
    rememberPaused('a', true)
    rememberTime('a', 42)
    expect(wasPaused('a')).toBe(true)
    expect(sessionTime('a')).toBe(42)
    rememberPaused('a', false)
    expect(sessionTime('a')).toBe(42)
  })

  it('ignores a nonsense time', () => {
    rememberTime('a', 10)
    rememberTime('a', Number.NaN)
    rememberTime('a', -1)
    expect(sessionTime('a')).toBe(10)
  })

  it('forgets both halves together', () => {
    rememberPaused('a', true)
    rememberTime('a', 10)
    forgetPaused('a')
    expect(wasPaused('a')).toBe(false)
    expect(sessionTime('a')).toBe(0)
  })
})
