import { beforeEach, describe, expect, it } from 'vitest'
import { forgetPaused, rememberPaused, wasPaused } from './playState'

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
