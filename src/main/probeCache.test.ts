import { describe, expect, it } from 'vitest'
import type { MediaInfo } from './ffmpeg'
import { createProbeCache } from './probeCache'

const info = { duration: 60 } as unknown as MediaInfo

describe('the probe cache', () => {
  it('shares a probe still running: two asks at one mount spawn ONE ffprobe (2026-10-16)', async () => {
    let calls = 0
    let finish: (v: MediaInfo | null) => void = () => {}
    const probed = createProbeCache(
      () => {
        calls += 1
        return new Promise((r) => (finish = r))
      },
      async () => 1
    )
    const a = probed('C:\\film.wmv')
    const b = probed('C:\\film.wmv')
    // Both asks have passed the mtime await before the probe answers.
    await new Promise((r) => setTimeout(r, 0))
    finish(info)
    expect(await a).toBe(info)
    expect(await b).toBe(info)
    expect(calls).toBe(1)
  })

  it('probes again after an edit (a new mtime)', async () => {
    let calls = 0
    let mtime = 1
    const probed = createProbeCache(
      async () => {
        calls += 1
        return info
      },
      async () => mtime
    )
    await probed('a.mkv')
    await probed('a.mkv')
    mtime = 2
    await probed('a.mkv')
    expect(calls).toBe(2)
  })

  it('answers null for a file it cannot stat, without probing', async () => {
    let calls = 0
    const probed = createProbeCache(
      async () => {
        calls += 1
        return info
      },
      () => Promise.reject(new Error('ENOENT'))
    )
    expect(await probed('gone.mkv')).toBeNull()
    expect(calls).toBe(0)
  })

  it('does not keep a probe that threw', async () => {
    let calls = 0
    const probed = createProbeCache(
      async () => {
        calls += 1
        if (calls === 1) throw new Error('spawn failed')
        return info
      },
      async () => 1
    )
    await expect(probed('a.mkv')).rejects.toThrow()
    expect(await probed('a.mkv')).toBe(info)
  })
})
