import { describe, expect, it } from 'vitest'
import { SWEEP_CHANNELS, parseBegin, parseEnd, parseUpdate, type SweepBegin, type SweepUpdate } from './sweepOverlay'

const begin: SweepBegin = {
  id: 3,
  anchor: { x: 120.5, y: 300 },
  clip: { left: 10, top: 40, right: 810, bottom: 640 },
  dpr: 2.25,
  fill: [10, 20, 30, 41],
  edge: [200, 210, 220, 255]
}
const update: SweepUpdate = {
  id: 3,
  cause: 'auto',
  anchor: { x: 120.5, y: 280 },
  clip: { left: 10, top: 40, right: 810, bottom: 640 },
  dpr: 2.25
}

describe('sweep overlay messages', () => {
  it('names its channels', () => {
    expect(SWEEP_CHANNELS).toEqual({
      begin: 'sweep-overlay:begin',
      update: 'sweep-overlay:update',
      end: 'sweep-overlay:end',
      state: 'sweep-overlay:state'
    })
  })

  it('accepts well-formed messages and copies only what it knows', () => {
    expect(parseBegin(begin)).toEqual(begin)
    expect(parseBegin({ ...begin, extra: 1 })).toEqual(begin)
    expect(parseUpdate(update)).toEqual(update)
    expect(parseUpdate({ ...update, cause: 'scroll' })?.cause).toBe('scroll')
    expect(parseUpdate({ ...update, cause: 'resize' })?.cause).toBe('resize')
    expect(parseEnd({ id: 3 })).toEqual({ id: 3 })
  })

  it('accepts a zero-size clip and negative coordinates in range', () => {
    expect(parseBegin({ ...begin, clip: { left: 5, top: 5, right: 5, bottom: 5 } })).not.toBeNull()
    expect(parseBegin({ ...begin, anchor: { x: -20, y: -99_999 } })).not.toBeNull()
  })

  it('refuses numbers that are not finite', () => {
    expect(parseBegin({ ...begin, anchor: { x: NaN, y: 0 } })).toBeNull()
    expect(parseBegin({ ...begin, anchor: { x: 0, y: Infinity } })).toBeNull()
    expect(parseBegin({ ...begin, clip: { ...begin.clip, right: -Infinity } })).toBeNull()
    expect(parseUpdate({ ...update, dpr: NaN })).toBeNull()
  })

  it('refuses a negative-size clip', () => {
    expect(parseBegin({ ...begin, clip: { left: 100, top: 0, right: 99, bottom: 10 } })).toBeNull()
    expect(parseUpdate({ ...update, clip: { left: 0, top: 50, right: 10, bottom: 49 } })).toBeNull()
  })

  it('refuses coordinates beyond 100000 either way', () => {
    expect(parseBegin({ ...begin, anchor: { x: 100_001, y: 0 } })).toBeNull()
    expect(parseBegin({ ...begin, clip: { ...begin.clip, left: -100_001 } })).toBeNull()
    expect(parseUpdate({ ...update, clip: { ...update.clip, bottom: 1e9 } })).toBeNull()
  })

  it('refuses a dpr outside 0.25 to 8', () => {
    expect(parseBegin({ ...begin, dpr: 0.2 })).toBeNull()
    expect(parseBegin({ ...begin, dpr: 8.5 })).toBeNull()
    expect(parseBegin({ ...begin, dpr: 0 })).toBeNull()
    expect(parseBegin({ ...begin, dpr: 0.25 })).not.toBeNull()
    expect(parseBegin({ ...begin, dpr: 8 })).not.toBeNull()
  })

  it('refuses a colour byte outside 0 to 255 or not an integer', () => {
    expect(parseBegin({ ...begin, fill: [10, 20, 30, 256] })).toBeNull()
    expect(parseBegin({ ...begin, fill: [10, -1, 30, 40] })).toBeNull()
    expect(parseBegin({ ...begin, edge: [10, 20.5, 30, 40] })).toBeNull()
    expect(parseBegin({ ...begin, edge: [10, 20, 30] })).toBeNull()
    expect(parseBegin({ ...begin, edge: [10, 20, 30, 40, 50] })).toBeNull()
    expect(parseBegin({ ...begin, edge: '#ffffff' })).toBeNull()
  })

  it('refuses an id that is not a non-negative integer', () => {
    expect(parseBegin({ ...begin, id: 1.5 })).toBeNull()
    expect(parseBegin({ ...begin, id: -1 })).toBeNull()
    expect(parseBegin({ ...begin, id: '3' })).toBeNull()
    expect(parseEnd({ id: 2 ** 60 })).toBeNull()
    expect(parseEnd({})).toBeNull()
  })

  it('refuses an unknown cause', () => {
    expect(parseUpdate({ ...update, cause: 'wheel' })).toBeNull()
    expect(parseUpdate({ ...update, cause: undefined })).toBeNull()
  })

  it('refuses extra nesting and the wrong shapes', () => {
    expect(parseBegin({ ...begin, anchor: { x: { valueOf: () => 1 }, y: 0 } })).toBeNull()
    expect(parseBegin({ ...begin, anchor: { x: [1], y: 0 } })).toBeNull()
    expect(parseBegin({ ...begin, anchor: [1, 2] })).toBeNull()
    expect(parseBegin({ ...begin, clip: null })).toBeNull()
    expect(parseBegin(null)).toBeNull()
    expect(parseBegin('begin')).toBeNull()
    expect(parseUpdate([update])).toBeNull()
    expect(parseEnd(3)).toBeNull()
  })
})
