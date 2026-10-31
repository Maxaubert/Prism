import { describe, expect, it } from 'vitest'
import { canvasShown, drawLoopRuns, HIDDEN_POLL_MS, idleFrame, wantsResume } from './vizGuards'

describe('when the visualizer spends anything', () => {
  it('resumes the audio context only for a playing track', () => {
    expect(wantsResume('suspended', false)).toBe(true)
    expect(wantsResume('suspended', true)).toBe(false)
    expect(wantsResume('running', false)).toBe(false)
  })

  it('runs no loop without an element', () => {
    expect(drawLoopRuns(null)).toBe(false)
    expect(drawLoopRuns({})).toBe(true)
  })
})

describe('a paused visualizer parks (perf review, 2026-10-28)', () => {
  it('draws while playing, whatever else is true', () => {
    expect(idleFrame(false, 999, 45, false)).toBe('draw')
  })

  it('keeps drawing after a pause until the picture has settled', () => {
    expect(idleFrame(true, 45, 45, false)).toBe('draw')
  })

  it('parks once settled, asking for no more frames', () => {
    expect(idleFrame(true, 46, 45, false)).toBe('park')
  })

  it('draws again when the size or style changed under it', () => {
    expect(idleFrame(true, 46, 45, true)).toBe('draw')
  })
})

describe('a hidden visualizer paints nothing (#15)', () => {
  const canvas = (shown: boolean): { checkVisibility: (o?: Record<string, boolean>) => boolean; asked: Record<string, boolean>[] } => {
    const asked: Record<string, boolean>[] = []
    return {
      asked,
      checkVisibility: (o) => {
        asked.push(o ?? {})
        // Like the browser: only a check that is asked about `visibility`
        // sees a viewer kept mounted but invisible under Settings.
        return o?.visibilityProperty || o?.checkVisibilityCSS ? shown : true
      }
    }
  }

  it('paints a canvas that is on screen', () => {
    expect(canvasShown(canvas(true))).toBe(true)
  })

  it('does not paint one that is visibility:hidden (the viewer under Settings)', () => {
    expect(canvasShown(canvas(false))).toBe(false)
  })

  it('paints when the browser cannot say', () => {
    expect(canvasShown({})).toBe(true)
  })

  it('looks again at a low rate, not at the display refresh', () => {
    expect(HIDDEN_POLL_MS).toBeGreaterThanOrEqual(100)
  })
})
