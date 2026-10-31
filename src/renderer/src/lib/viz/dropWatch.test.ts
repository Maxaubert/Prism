import { describe, expect, it, vi } from 'vitest'
import { DROPS_MAX_SECONDS, dropsAllowed, watchDrops, type DropMedia } from './dropWatch'
import { drawLoopRuns, wantsResume } from './vizGuards'

/** A media element as far as the watch can tell: settable, and it fires. */
function fakeMedia(init: { duration: number; readyState: number; src?: string }) {
  const target = new EventTarget()
  const m = {
    duration: init.duration,
    readyState: init.readyState,
    currentSrc: init.src ?? 'fsmedia://local/track.mp3',
    src: init.src ?? 'fsmedia://local/track.mp3',
    addEventListener: (t: string, fn: () => void) => target.addEventListener(t, fn),
    removeEventListener: (t: string, fn: () => void) => target.removeEventListener(t, fn),
    fire: () => target.dispatchEvent(new Event('loadedmetadata'))
  }
  return m as typeof m & DropMedia
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('the drop analysis guard (review, 2026-10-16)', () => {
  it('refuses an UNKNOWN length, which is what the element says before its metadata', () => {
    expect(dropsAllowed(NaN)).toBe(false)
    expect(dropsAllowed(Infinity)).toBe(false)
    expect(dropsAllowed(0)).toBe(false)
    expect(dropsAllowed(180)).toBe(true)
    expect(dropsAllowed(DROPS_MAX_SECONDS + 1)).toBe(false)
  })

  it('decodes nothing at mount for an element with no metadata yet', () => {
    const media = fakeMedia({ duration: NaN, readyState: 0 })
    const analyse = vi.fn(async () => [1])
    watchDrops(media, analyse, () => {})
    expect(analyse).not.toHaveBeenCalled()
  })

  it('never decodes a four-hour audiobook, before or after its metadata', () => {
    const media = fakeMedia({ duration: NaN, readyState: 0 })
    const analyse = vi.fn(async () => [1])
    watchDrops(media, analyse, () => {})
    media.duration = 4 * 3600
    media.readyState = 1
    media.fire()
    expect(analyse).not.toHaveBeenCalled()
  })

  it('analyses a song ONCE when its metadata arrives', async () => {
    const media = fakeMedia({ duration: NaN, readyState: 0 })
    const analyse = vi.fn(async () => [12.5])
    const seen: number[][] = []
    watchDrops(media, analyse, (t) => seen.push(t))
    media.duration = 200
    media.readyState = 1
    media.fire()
    await flush()
    expect(analyse).toHaveBeenCalledTimes(1)
    expect(seen.at(-1)).toEqual([12.5])
  })

  it('runs at once for an element already loaded', () => {
    const media = fakeMedia({ duration: 200, readyState: 4 })
    const analyse = vi.fn(async () => [])
    watchDrops(media, analyse, () => {})
    expect(analyse).toHaveBeenCalledTimes(1)
  })

  it('aborts the previous run when a new source loads, and on cleanup', async () => {
    const media = fakeMedia({ duration: 200, readyState: 4 })
    const signals: AbortSignal[] = []
    const seen: number[][] = []
    const stop = watchDrops(
      media,
      (_url, signal) => {
        signals.push(signal)
        return new Promise(() => {})
      },
      (t) => seen.push(t)
    )
    media.fire()
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    stop()
    expect(signals[1].aborted).toBe(true)
  })
})

describe('the visualizer at rest (review, 2026-10-16)', () => {
  it('wakes the audio context only for a playing track', () => {
    expect(wantsResume(true, true)).toBe(false)
    expect(wantsResume(true, false)).toBe(true)
    expect(wantsResume(false, false)).toBe(false)
  })

  it('runs no draw loop for a hidden tab, which passes no element', () => {
    expect(drawLoopRuns(null)).toBe(false)
    expect(drawLoopRuns({})).toBe(true)
  })
})
