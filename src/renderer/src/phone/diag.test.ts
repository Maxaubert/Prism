import { describe, expect, it } from 'vitest'
import { BATCH, mediaState, pack } from './diag'

describe('phone diagnostics', () => {
  it('packs one batch and leaves the rest', () => {
    const lines = Array.from({ length: BATCH + 5 }, (_, i) => `l${i}`)
    const { send, rest } = pack(lines)
    expect(send).toHaveLength(BATCH)
    expect(rest).toEqual(['l40', 'l41', 'l42', 'l43', 'l44'])
    expect(pack([])).toEqual({ send: [], rest: [] })
  })

  it('describes a player in one line: position, buffer ahead, ranges, dropped frames', () => {
    const el = {
      currentTime: 12.5,
      paused: false,
      readyState: 4,
      playbackRate: 1,
      buffered: {
        length: 2,
        start: (i: number) => [0, 40][i],
        end: (i: number) => [30, 60][i]
      },
      getVideoPlaybackQuality: () => ({ droppedVideoFrames: 3, totalVideoFrames: 900 })
    } as unknown as HTMLVideoElement
    expect(mediaState(el)).toBe('t=12.50 playing ahead=17.50 ranges=2 ready=4 rate=1 dropped=3/900')
    // A position outside every range says so: that is the stall that is a
    // hole, not an empty buffer.
    const out = { ...el, currentTime: 35, buffered: el.buffered } as unknown as HTMLVideoElement
    expect(mediaState(out)).toContain('(outside buffer)')
  })
})
