import { describe, expect, it, vi } from 'vitest'
import { analyzeDrops, analyzeDropsAsync, type PcmSource } from './drops'

/** A 40 s stereo track: quiet build-ups, then a slam, every 10 s. Deterministic. */
function track(seconds = 40, sr = 8000): PcmSource {
  const n = seconds * sr
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const phase = t % 10
    const amp = phase < 8 ? 0.05 : 0.9
    l[i] = amp * Math.sin(2 * Math.PI * 60 * t)
    r[i] = amp * Math.sin(2 * Math.PI * 90 * t + 1)
  }
  return { sampleRate: sr, length: n, numberOfChannels: 2, getChannelData: (c) => (c === 0 ? l : r) }
}

describe('drop analysis (audit #61)', () => {
  it('finds the slams', () => {
    const drops = analyzeDrops(track())
    expect(drops.length).toBeGreaterThan(0)
    for (const d of drops) expect(d % 10).toBeGreaterThan(7.5)
  })

  it('the sliced async analysis answers exactly what the one-shot did', async () => {
    const src = track()
    expect(await analyzeDropsAsync(src, 12, undefined, async () => {})).toEqual(analyzeDrops(src))
  })

  it('pauses between slices so the UI thread is never held for the whole track', async () => {
    const pause = vi.fn(async () => {})
    await analyzeDropsAsync(track(), 12, undefined, pause)
    expect(pause.mock.calls.length).toBeGreaterThan(1)
  })

  it('stops early when aborted', async () => {
    const ctl = new AbortController()
    ctl.abort()
    expect(await analyzeDropsAsync(track(), 12, ctl.signal, async () => {})).toEqual([])
  })

  it('holds no whole-track working arrays: only the envelopes', async () => {
    const src = track()
    const sizes: number[] = []
    const Real = Float32Array
    const spy = vi.spyOn(globalThis, 'Float32Array').mockImplementation((function (n: number) {
      sizes.push(n)
      return new Real(n)
    }) as never)
    try {
      await analyzeDropsAsync(src, 12, undefined, async () => {})
    } finally {
      spy.mockRestore()
    }
    expect(Math.max(...sizes)).toBeLessThan(src.length / 10)
  })
})