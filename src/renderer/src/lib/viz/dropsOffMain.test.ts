import { describe, expect, it } from 'vitest'
import { analyzeDrops, type PcmSource } from './drops'
import { analyzeDropsOffMain, decimateMono, SCAN_RATE } from './dropsOffMain'

function track(seconds = 40, sr = 8000): PcmSource {
  const n = seconds * sr
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const amp = t % 10 < 8 ? 0.05 : 0.9
    l[i] = amp * Math.sin(2 * Math.PI * 60 * t)
    r[i] = amp * Math.sin(2 * Math.PI * 90 * t + 1)
  }
  return { sampleRate: sr, length: n, numberOfChannels: 2, getChannelData: (c) => (c === 0 ? l : r) }
}

const none = async (): Promise<void> => {}

describe('drop scan off the main thread (audit #61)', () => {
  it('decimates to a small mono copy', async () => {
    const src = track()
    const mono = await decimateMono(src, undefined, none)
    expect(mono?.numberOfChannels).toBe(1)
    expect(mono?.sampleRate).toBeLessThanOrEqual(SCAN_RATE)
    expect(mono!.length).toBeLessThan(src.length / 3)
  })

  it('finds the same drops as the full-rate scan, within a frame or two', async () => {
    const src = track()
    const full = analyzeDrops(src)
    const off = await analyzeDropsOffMain(src, 12, undefined, none)
    expect(off.length).toBe(full.length)
    off.forEach((t, i) => expect(Math.abs(t - full[i])).toBeLessThan(0.1))
  })

  it('stops early when aborted', async () => {
    const ctl = new AbortController()
    ctl.abort()
    expect(await analyzeDropsOffMain(track(), 12, ctl.signal, none)).toEqual([])
  })
})
