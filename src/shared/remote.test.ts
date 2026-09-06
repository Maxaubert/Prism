import { describe, expect, it } from 'vitest'
import { emptyState, parseCmd, stateChanged, type RemoteState } from './remote'

describe('emptyState', () => {
  it('is nothing open, at a sane volume and speed', () => {
    const s = emptyState()
    expect(s.empty).toBe(true)
    expect(s.name).toBe('')
    expect(s.kind).toBe('')
    expect(s.playing).toBe(false)
    expect(s.cur).toBe(0)
    expect(s.dur).toBe(0)
    expect(s.vol).toBe(1)
    expect(s.muted).toBe(false)
    expect(s.rate).toBe(1)
    expect(s.canNext).toBe(false)
    expect(s.canPrev).toBe(false)
  })

  it('hands out a fresh object each time', () => {
    expect(emptyState()).not.toBe(emptyState())
  })
})

describe('parseCmd', () => {
  it('accepts every bare op', () => {
    for (const op of ['play', 'pause', 'toggle', 'next', 'prev', 'mute'] as const)
      expect(parseCmd({ op })).toEqual({ op })
  })

  it('accepts the ops that carry a number, and keeps only what it validated', () => {
    expect(parseCmd({ op: 'seek', to: 12.5 })).toEqual({ op: 'seek', to: 12.5 })
    expect(parseCmd({ op: 'seek', to: 0 })).toEqual({ op: 'seek', to: 0 })
    expect(parseCmd({ op: 'step', by: -10 })).toEqual({ op: 'step', by: -10 })
    expect(parseCmd({ op: 'step', by: 600 })).toEqual({ op: 'step', by: 600 })
    expect(parseCmd({ op: 'volume', to: 0 })).toEqual({ op: 'volume', to: 0 })
    expect(parseCmd({ op: 'volume', to: 2 })).toEqual({ op: 'volume', to: 2 })
    expect(parseCmd({ op: 'volume', to: 0.5, extra: 'x' })).toEqual({ op: 'volume', to: 0.5 })
  })

  it('refuses unknown ops and anything that is not an object', () => {
    expect(parseCmd({ op: 'stop' })).toBeNull()
    expect(parseCmd({ op: 'PLAY' })).toBeNull()
    expect(parseCmd({ op: '' })).toBeNull()
    expect(parseCmd({})).toBeNull()
    expect(parseCmd({ op: 1 })).toBeNull()
    expect(parseCmd(null)).toBeNull()
    expect(parseCmd(undefined)).toBeNull()
    expect(parseCmd('play')).toBeNull()
    expect(parseCmd(42)).toBeNull()
    expect(parseCmd(['play'])).toBeNull()
  })

  it('refuses a number that is missing, not a number, or out of range', () => {
    expect(parseCmd({ op: 'seek' })).toBeNull()
    expect(parseCmd({ op: 'seek', to: '5' })).toBeNull()
    expect(parseCmd({ op: 'seek', to: NaN })).toBeNull()
    expect(parseCmd({ op: 'seek', to: Infinity })).toBeNull()
    expect(parseCmd({ op: 'seek', to: -1 })).toBeNull()
    expect(parseCmd({ op: 'step' })).toBeNull()
    expect(parseCmd({ op: 'step', by: NaN })).toBeNull()
    expect(parseCmd({ op: 'step', by: 601 })).toBeNull()
    expect(parseCmd({ op: 'step', by: -601 })).toBeNull()
    expect(parseCmd({ op: 'volume' })).toBeNull()
    expect(parseCmd({ op: 'volume', to: NaN })).toBeNull()
    expect(parseCmd({ op: 'volume', to: 3 })).toBeNull()
    expect(parseCmd({ op: 'volume', to: -0.1 })).toBeNull()
  })
})

describe('stateChanged', () => {
  const base = (): RemoteState => ({
    empty: false,
    name: 'ep1.mp4',
    kind: 'video',
    playing: true,
    cur: 10,
    dur: 100,
    vol: 1,
    muted: false,
    rate: 1,
    canNext: true,
    canPrev: false,
  })

  it('is not a change for the same object or an equal copy', () => {
    const a = base()
    expect(stateChanged(a, a)).toBe(false)
    expect(stateChanged(a, base())).toBe(false)
  })

  it('lets a small tick of the clock pass and reports a second', () => {
    expect(stateChanged(base(), { ...base(), cur: 10.5 })).toBe(false)
    expect(stateChanged(base(), { ...base(), cur: 10.8 })).toBe(false)
    expect(stateChanged(base(), { ...base(), cur: 11 })).toBe(true)
    expect(stateChanged(base(), { ...base(), cur: 9 })).toBe(true)
  })

  it('reports any move of a paused clock, which can only be a seek', () => {
    const paused = { ...base(), playing: false }
    expect(stateChanged(paused, { ...paused, cur: 10.5 })).toBe(true)
    expect(stateChanged(paused, { ...paused, cur: 9.9 })).toBe(true)
    expect(stateChanged(paused, { ...paused })).toBe(false)
  })

  it('reports every other field', () => {
    expect(stateChanged(base(), { ...base(), playing: false })).toBe(true)
    expect(stateChanged(base(), { ...base(), name: 'ep2.mp4' })).toBe(true)
    expect(stateChanged(base(), { ...base(), kind: 'audio' })).toBe(true)
    expect(stateChanged(base(), { ...base(), dur: 101 })).toBe(true)
    expect(stateChanged(base(), { ...base(), vol: 0.9 })).toBe(true)
    expect(stateChanged(base(), { ...base(), muted: true })).toBe(true)
    expect(stateChanged(base(), { ...base(), rate: 1.5 })).toBe(true)
    expect(stateChanged(base(), { ...base(), canNext: false })).toBe(true)
    expect(stateChanged(base(), { ...base(), canPrev: true })).toBe(true)
    expect(stateChanged(base(), emptyState())).toBe(true)
  })
})
