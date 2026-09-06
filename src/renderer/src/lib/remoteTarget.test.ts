import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTarget, getTarget, onTarget, setTarget, type Target } from './remoteTarget'
import type { MediaControls } from './useMediaControls'

// The registry never calls into the controls, so a bare cast is all a test
// needs to stand one in.
const controls = (playing: boolean): MediaControls =>
  ({ playing, cur: 0, dur: 0 }) as unknown as MediaControls

const target = (id: string, playing = false, kind: Target['kind'] = 'video'): Target => ({
  id,
  kind,
  controls: controls(playing)
})

beforeEach(() => setTarget(null))

describe('the remote target registry', () => {
  it('starts empty', () => {
    expect(getTarget()).toBeNull()
  })

  it('holds what was set, and hands the same object back', () => {
    const t = target('a')
    setTarget(t)
    expect(getTarget()).toBe(t)
  })

  it('a later set replaces the earlier one', () => {
    setTarget(target('a'))
    const b = target('b', true, 'audio')
    setTarget(b)
    expect(getTarget()).toBe(b)
    expect(getTarget()?.kind).toBe('audio')
  })

  it('null clears it', () => {
    setTarget(target('a'))
    setTarget(null)
    expect(getTarget()).toBeNull()
  })

  it('tells a subscriber about every change, with the new value', () => {
    const cb = vi.fn()
    onTarget(cb)
    const a = target('a')
    setTarget(a)
    setTarget(null)
    expect(cb).toHaveBeenCalledTimes(2)
    expect(cb).toHaveBeenNthCalledWith(1, a)
    expect(cb).toHaveBeenNthCalledWith(2, null)
  })

  it('tells every subscriber, and only the ones still subscribed', () => {
    const one = vi.fn()
    const two = vi.fn()
    const offOne = onTarget(one)
    onTarget(two)
    setTarget(target('a'))
    offOne()
    setTarget(target('b'))
    expect(one).toHaveBeenCalledTimes(1)
    expect(two).toHaveBeenCalledTimes(2)
  })

  it('is quiet about a set that changes nothing', () => {
    const cb = vi.fn()
    onTarget(cb)
    setTarget(null)
    const a = target('a')
    setTarget(a)
    setTarget(a)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('does not replay the current value on subscribe', () => {
    setTarget(target('a'))
    const cb = vi.fn()
    onTarget(cb)
    expect(cb).not.toHaveBeenCalled()
  })

  describe('clearTarget, the identity-guarded unregister', () => {
    it('clears the target that carries the id', () => {
      const cb = vi.fn()
      onTarget(cb)
      setTarget(target('a'))
      clearTarget('a')
      expect(getTarget()).toBeNull()
      expect(cb).toHaveBeenLastCalledWith(null)
    })

    it('a player unmounting after the next one registered leaves it alone', () => {
      // The viewer swaps films in one commit: the new player registers, then
      // the old one's cleanup runs. That cleanup must not clear the new one.
      setTarget(target('old'))
      const fresh = target('new')
      setTarget(fresh)
      const cb = vi.fn()
      onTarget(cb)
      clearTarget('old')
      expect(getTarget()).toBe(fresh)
      expect(cb).not.toHaveBeenCalled()
    })

    it('clears by id, however many snapshots that player published', () => {
      // The hook re-registers a fresh snapshot on every clock tick; the id
      // is the same across them, and it is the id that is checked.
      setTarget(target('a'))
      setTarget(target('a', true))
      clearTarget('a')
      expect(getTarget()).toBeNull()
    })

    it('is quiet when nothing is registered', () => {
      const cb = vi.fn()
      onTarget(cb)
      clearTarget('a')
      expect(getTarget()).toBeNull()
      expect(cb).not.toHaveBeenCalled()
    })
  })

  it('unsubscribing twice is harmless', () => {
    const cb = vi.fn()
    const off = onTarget(cb)
    off()
    off()
    setTarget(target('a'))
    expect(cb).not.toHaveBeenCalled()
  })
})
