import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ABORT_GRACE_MS, loadImage, preloadImage, resetImageCache } from './imageLoader'

/** A fetch the test answers by hand, and the signal each call was given. */
function fakeFetch(): { calls: { url: string; signal: AbortSignal; answer: () => void }[] } {
  const calls: { url: string; signal: AbortSignal; answer: () => void }[] = []
  vi.stubGlobal(
    'fetch',
    (url: string, init: { signal: AbortSignal }) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init.signal
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        calls.push({ url, signal, answer: () => resolve(new Response(new Blob([new Uint8Array(16)]))) })
      })
  )
  return { calls }
}

describe('image reads nobody wants are given up (perf review, 2026-10-28)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    resetImageCache()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('aborts the read once its only caller has stepped past, after the grace', async () => {
    const { calls } = fakeFetch()
    const stop = new AbortController()
    const p = loadImage('fsmedia://a.jpg', stop.signal)
    stop.abort()
    await expect(p).rejects.toThrow()
    expect(calls[0].signal.aborted).toBe(false)
    vi.advanceTimersByTime(ABORT_GRACE_MS)
    expect(calls[0].signal.aborted).toBe(true)
    // Nothing was cached: asking again reads again.
    void loadImage('fsmedia://a.jpg').catch(() => {})
    expect(calls).toHaveLength(2)
  })

  it('hands a warming neighbour to the viewer that steps onto it in the same commit', async () => {
    const { calls } = fakeFetch()
    const warm = new AbortController()
    preloadImage('fsmedia://b.jpg', warm.signal)
    // The warm-up's cleanup runs first, then the viewer's effect joins.
    warm.abort()
    const view = new AbortController()
    const p = loadImage('fsmedia://b.jpg', view.signal)
    vi.advanceTimersByTime(ABORT_GRACE_MS * 2)
    expect(calls).toHaveLength(1)
    expect(calls[0].signal.aborted).toBe(false)
    calls[0].answer()
    await vi.advanceTimersByTimeAsync(0)
    const img = await p
    expect(img.blob.size).toBe(16)
  })

  it('keeps a read that a caller without a signal is waiting for', () => {
    const { calls } = fakeFetch()
    const held = loadImage('fsmedia://c.jpg')
    const stop = new AbortController()
    void loadImage('fsmedia://c.jpg', stop.signal).catch(() => {})
    stop.abort()
    vi.advanceTimersByTime(ABORT_GRACE_MS * 2)
    expect(calls).toHaveLength(1)
    expect(calls[0].signal.aborted).toBe(false)
    void held.catch(() => {})
  })

  it('never starts a read for a caller that has already gone', async () => {
    const { calls } = fakeFetch()
    const stop = new AbortController()
    stop.abort()
    await expect(loadImage('fsmedia://d.jpg', stop.signal)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})
