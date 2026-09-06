import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askPlay, installShim, type PlayAnswer } from './prismShim'
import { writeToken } from './api'

// The unit tests run under node, where `window` does not exist; in a browser
// it IS globalThis, which is where the shim installs itself.
if (typeof window === 'undefined')
  Object.defineProperty(globalThis, 'window', { value: globalThis })

// What the device plays is a `<video>` question, and node has no `<video>`.
vi.mock('./canPlay', () => ({ canCsv: () => 'h264,aac,mp4', nativeHls: () => false }))

/** A fetch that answers `/api/play` with a fixed verdict and records the asks. */
function answerPlay(answer: PlayAnswer | ((path: string) => PlayAnswer)): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (u: string) => {
    const url = new URL(u, 'http://phone')
    if (url.pathname !== '/api/play') return new Response('{"error":"no"}', { status: 404 })
    const a = typeof answer === 'function' ? answer(url.searchParams.get('path') ?? '') : answer
    return new Response(JSON.stringify(a), { status: 200 })
  })
  vi.stubGlobal('fetch', f)
  return f
}

describe('the phone shim', () => {
  beforeEach(() => {
    localStorage.clear()
    writeToken('tok')
    installShim()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  it('builds media urls with the token', () => {
    expect(window.prism.mediaUrl('C:\\x.mp4')).toBe('/m/C%3A%5Cx.mp4?t=tok')
  })
  it('says what it cannot do, and never throws for it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Neither is on PrismApi yet: `capabilities` is the shim's own, and
    // `nativeDrag` arrives with #103.
    const p = window.prism as unknown as {
      nativeDrag: boolean
      capabilities: unknown
      trashFile: (p: string) => Promise<unknown>
    }
    expect(p.nativeDrag).toBe(false)
    expect(p.capabilities).toEqual({ write: false, clipboard: false, explorer: false, drag: false })
    await expect(p.trashFile('x')).resolves.toBe(false)
    await expect(p.trashFile('y')).resolves.toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
  it('hands the video hook an unsubscribe, not a promise', () => {
    const off = window.prism.onConvertProgress(() => {})
    expect(typeof off).toBe('function')
    expect(() => window.prism.cancelConvert('x')).not.toThrow()
  })
  it('is not a thenable, so nothing awaiting it hangs', () => {
    expect((window.prism as unknown as { then?: unknown }).then).toBeUndefined()
  })

  describe('playing through /api/play', () => {
    it('asks with the token and what the device plays', async () => {
      const f = answerPlay({ mode: 'direct', url: '/m/x?t=tok', fps: 24, duration: 10 })
      await askPlay('C:\\a.mp4')
      const asked = new URL(String(f.mock.calls[0][0]), 'http://phone')
      expect(asked.pathname).toBe('/api/play')
      expect(asked.searchParams.get('path')).toBe('C:\\a.mp4')
      expect(asked.searchParams.get('can')).toBe('h264,aac,mp4')
      expect(asked.searchParams.get('t')).toBe('tok')
    })
    it('a direct file is a probe with nothing to convert, and the frame rate', async () => {
      answerPlay({ mode: 'direct', url: '/m/x?t=tok', fps: 24, duration: 10 })
      await expect(window.prism.probeMedia('C:\\a.mp4')).resolves.toEqual({ ffmpeg: true, needed: false, fps: 24 })
      await expect(window.prism.convertVideo('C:\\a.mp4')).resolves.toMatchObject({ error: expect.any(String) })
    })
    it('an hls film is a "conversion" whose copy is the playlist, quick when the picture is copied', async () => {
      answerPlay((path) => ({
        mode: 'hls',
        url: `/hls/0123456789abcdef/index.m3u8?t=tok`,
        copyVideo: path.endsWith('copy.mkv'),
        audioOnly: false,
        fps: 23.976,
        duration: 6000
      }))
      await expect(window.prism.probeMedia('C:\\copy.mkv')).resolves.toEqual({
        ffmpeg: true,
        needed: false,
        fps: 23.976,
        convert: { reason: 'container', quick: true }
      })
      await expect(window.prism.probeMedia('C:\\encode.mkv')).resolves.toMatchObject({
        convert: { reason: 'container', quick: false }
      })
      await expect(window.prism.convertVideo('C:\\copy.mkv')).resolves.toEqual({
        url: '/hls/0123456789abcdef/index.m3u8?t=tok'
      })
    })
    it('an audio-only hls stream IS the source, the way the PC decoder is', async () => {
      answerPlay({ mode: 'hls', url: '/hls/0123456789abcdef/index.m3u8?t=tok', copyVideo: false, audioOnly: true, fps: null, duration: 200 })
      await expect(window.prism.probeMedia('C:\\a.wma')).resolves.toEqual({
        ffmpeg: true,
        needed: true,
        url: '/hls/0123456789abcdef/index.m3u8?t=tok'
      })
    })
    it('none is no ffmpeg, with the reason kept for the shell', async () => {
      answerPlay({ mode: 'none', reason: 'Prism could not read this file' })
      await expect(window.prism.probeMedia('C:\\a.mkv')).resolves.toEqual({ ffmpeg: false, needed: false })
      await expect(window.prism.convertVideo('C:\\a.mkv')).resolves.toEqual({ error: 'Prism could not read this file' })
    })
    it('asks once per file, for every hook that wants to know, and again once the answer is stale', async () => {
      vi.useFakeTimers({ now: 1_000 })
      const f = answerPlay({ mode: 'direct', url: '/m/x?t=tok', fps: 24, duration: 10 })
      await askPlay('C:\\b.mp4')
      await window.prism.probeMedia('C:\\b.mp4')
      await window.prism.convertVideo('C:\\b.mp4')
      expect(f).toHaveBeenCalledTimes(1)
      await askPlay('C:\\c.mp4')
      expect(f).toHaveBeenCalledTimes(2)
      // A job the PC has reaped is gone with its url; an answer older than
      // the reap window is asked again rather than trusted.
      vi.setSystemTime(1_000 + 20_000)
      await askPlay('C:\\b.mp4')
      expect(f).toHaveBeenCalledTimes(3)
    })
    it('a refused ask is not remembered: the next one tries again', async () => {
      const f = vi.fn(async () => new Response('{"error":"forgotten"}', { status: 401 }))
      vi.stubGlobal('fetch', f)
      await expect(askPlay('C:\\d.mp4')).rejects.toThrow('forgotten')
      await expect(window.prism.probeMedia('C:\\d.mp4')).resolves.toEqual({ ffmpeg: false, needed: false })
      expect(f).toHaveBeenCalledTimes(2)
    })
  })
})
