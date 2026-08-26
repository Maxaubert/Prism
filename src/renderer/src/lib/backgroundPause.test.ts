import { describe, expect, it } from 'vitest'
import { decide, isAway } from './backgroundPause'

const playing = { paused: false }
const stopped = { paused: true }

describe('what counts as away', () => {
  it('is another window having the focus', () => {
    expect(isAway({ minimised: false, focused: false })).toBe(true)
  })

  it('is also being minimised, whatever the focus says', () => {
    // A minimised window normally has no focus either, but Windows does not
    // promise the two events in any order.
    expect(isAway({ minimised: true, focused: true })).toBe(true)
  })

  it('is not being the window you are looking at', () => {
    expect(isAway({ minimised: false, focused: true })).toBe(false)
  })
})

describe('what to do about it', () => {
  it('pauses a playing file when you go away', () => {
    expect(decide({ minimised: false, focused: false }, playing, false)).toEqual({
      action: 'pause',
      ours: true
    })
  })

  it('carries on when you come back', () => {
    expect(decide({ minimised: false, focused: true }, stopped, true)).toEqual({
      action: 'play',
      ours: false
    })
  })

  it('NEVER resumes what you paused by hand', () => {
    // ours=false: this feature did not stop it, so it is not this feature's to
    // start again.
    expect(decide({ minimised: false, focused: true }, stopped, false)).toEqual({
      action: 'none',
      ours: false
    })
  })

  it('does not pause what is already stopped, or claim it', () => {
    expect(decide({ minimised: true, focused: false }, stopped, false)).toEqual({
      action: 'none',
      ours: false
    })
  })

  it('survives two away signals in a row without losing the claim', () => {
    // Windows sends blur and minimize separately; the second must not read as
    // "the user paused this".
    const first = decide({ minimised: false, focused: false }, playing, false)
    expect(first).toEqual({ action: 'pause', ours: true })
    expect(decide({ minimised: true, focused: false }, stopped, first.ours)).toEqual({
      action: 'none',
      ours: true
    })
  })
})
