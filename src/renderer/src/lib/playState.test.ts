import { beforeEach, describe, expect, it } from 'vitest'
import { forgetPaused, intendToPlay, rememberPaused, rememberTime, sessionTime, wasPaused, wasPlaying, whenIntended, carriesOn, heldPaused, pauseQuietly, wasQuietPause } from './playState'

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

describe('whether a pause was yours (#491)', () => {
  beforeEach(() => forgetPaused('film'))

  it('holds a film you paused', () => {
    rememberPaused('film', true)
    expect(heldPaused('film')).toBe(true)
    expect(carriesOn('film')).toBe(false)
  })
  it('does not hold a film that ran out or that the app paused', () => {
    rememberPaused('film', true, false)
    expect(heldPaused('film')).toBe(false)
    expect(carriesOn('film')).toBe(true)
    expect(wasPlaying('film')).toBe(false)
  })
  it('lets go on a play or a pick', () => {
    rememberPaused('film', true)
    rememberPaused('film', false)
    expect(heldPaused('film')).toBe(false)
    rememberPaused('film', true)
    intendToPlay('film')
    expect(heldPaused('film')).toBe(false)
  })
  it('a file nobody started hands nothing on', () => {
    expect(carriesOn('never-seen')).toBe(false)
    expect(heldPaused('never-seen')).toBe(false)
  })
  it('a quiet pause is read once, and only when it really paused', () => {
    const fake = { paused: false, pause(): void { fake.paused = true } }
    const el = fake as unknown as HTMLMediaElement
    pauseQuietly(el)
    expect(fake.paused).toBe(true)
    expect(wasQuietPause(el)).toBe(true)
    expect(wasQuietPause(el)).toBe(false)
    // Already paused: no event is coming, so nothing may be left waiting.
    pauseQuietly(el)
    expect(wasQuietPause(el)).toBe(false)
  })
})

describe('what starts playing on its own', () => {
  it('does NOT play a file nobody has played this session', () => {
    // Opening a file, or restoring a window full of tabs, must not start
    // anything (2026-08-28, owner decision).
    expect(wasPlaying('never-seen')).toBe(false)
    expect(wasPaused('never-seen')).toBe(false)
  })

  it('plays one whose player is being rebuilt mid-play', () => {
    rememberPaused('a', false)
    expect(wasPlaying('a')).toBe(true)
  })

  it('leaves a file you stopped stopped', () => {
    rememberPaused('a', true)
    expect(wasPlaying('a')).toBe(false)
  })

  it('lets the playlist say "play this one when it arrives"', () => {
    expect(wasPlaying('b')).toBe(false)
    intendToPlay('b')
    expect(wasPlaying('b')).toBe(true)
  })

  it('ignores an intent with no file', () => {
    intendToPlay('')
    expect(wasPlaying('')).toBe(false)
  })

  it('tells a player already holding the file about a repeat pick (#139)', () => {
    let heard = 0
    const off = whenIntended('c', () => {
      heard += 1
    })
    intendToPlay('c')
    intendToPlay('other')
    expect(heard).toBe(1)
    off()
    intendToPlay('c')
    expect(heard).toBe(1)
  })
})
