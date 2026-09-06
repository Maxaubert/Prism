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
    // `capabilities` is on both bridges since #106; `nativeDrag` is not on
    // PrismApi yet (it arrives with #103), so the cast covers it.
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

  describe('documents through the read-only routes (#106)', () => {
    /** A fetch that answers one route with a body and records what was asked. */
    function answer(route: string, body: unknown, status = 200): ReturnType<typeof vi.fn> {
      const f = vi.fn(async (u: string) => {
        const url = new URL(u, 'http://phone')
        if (url.pathname !== route) return new Response('{"error":"no"}', { status: 404 })
        return new Response(JSON.stringify(body), { status })
      })
      vi.stubGlobal('fetch', f)
      return f
    }
    const asked = (f: ReturnType<typeof vi.fn>): URL => new URL(String(f.mock.calls[0][0]), 'http://phone')

    it('readText hits /api/text with the token, and a refusal reads as unreadable', async () => {
      const f = answer('/api/text', { text: 'hello' })
      await expect(window.prism.readText('C:\\a.txt')).resolves.toEqual({ text: 'hello' })
      expect(asked(f).pathname).toBe('/api/text')
      expect(asked(f).searchParams.get('path')).toBe('C:\\a.txt')
      expect(asked(f).searchParams.get('t')).toBe('tok')
      answer('/api/text', { error: 'forgotten' }, 401)
      await expect(window.prism.readText('C:\\a.txt')).resolves.toEqual({ error: 'unreadable' })
    })
    it('docHtml unwraps the html, and null for a document Prism could not convert', async () => {
      answer('/api/doc', { html: '<p>doc</p>' })
      await expect(window.prism.docHtml('C:\\a.docx')).resolves.toBe('<p>doc</p>')
      answer('/api/doc', { error: 'no' }, 404)
      await expect(window.prism.docHtml('C:\\a.docx')).resolves.toBeNull()
    })
    it('comicOpen passes the password along and answers failures in the IPC shape', async () => {
      const f = answer('/api/comic', { pages: ['C:\\c\\p1.jpg'] })
      await expect(window.prism.comicOpen('C:\\b.cbz', 'pw')).resolves.toEqual({ pages: ['C:\\c\\p1.jpg'] })
      expect(asked(f).searchParams.get('pw')).toBe('pw')
      answer('/api/comic', { error: 'no' }, 500)
      await expect(window.prism.comicOpen('C:\\b.cbz')).resolves.toEqual({ error: 'failed' })
    })
    it('archiveList and archiveExtract pass the entry and password, and fail in the IPC shape', async () => {
      answer('/api/archive', { ok: true, entries: [] })
      await expect(window.prism.archiveList('C:\\z.zip')).resolves.toEqual({ ok: true, entries: [] })
      const f = answer('/api/archive/extract', { ok: true, path: 'C:\\t\\pic.png', kind: 'image' })
      await expect(window.prism.archiveExtract('C:\\z.zip', 'inner/pic.png', 'pw')).resolves.toEqual({
        ok: true,
        path: 'C:\\t\\pic.png',
        kind: 'image'
      })
      expect(asked(f).searchParams.get('entry')).toBe('inner/pic.png')
      expect(asked(f).searchParams.get('pw')).toBe('pw')
      answer('/api/archive', { error: 'no' }, 403)
      await expect(window.prism.archiveList('C:\\z.zip')).resolves.toEqual({ ok: false, reason: 'failed' })
      await expect(window.prism.archiveExtract('C:\\z.zip', 'x')).resolves.toEqual({ ok: false, reason: 'failed' })
    })
    it('statFile hits /api/stat and answers null for a file that is not there', async () => {
      answer('/api/stat', { size: 4, mtimeMs: 1, isFolder: false })
      await expect(window.prism.statFile('C:\\a.txt')).resolves.toEqual({ size: 4, mtimeMs: 1, isFolder: false })
      answer('/api/stat', { error: 'no' }, 404)
      await expect(window.prism.statFile('C:\\gone.txt')).resolves.toBeNull()
    })
    it('the archive panel reads every container as read-only, and a tail as nothing', async () => {
      await expect(window.prism.archiveStat('C:\\z.zip')).resolves.toMatchObject({ readOnly: true })
      await expect(window.prism.tailBytes('C:\\big.log', 100)).resolves.toBeNull()
      await expect(window.prism.startTail('C:\\big.log', 0)).resolves.toBe(false)
      await expect(window.prism.stopTail('C:\\big.log')).resolves.toBeUndefined()
    })
    it('has no way to write: the write verbs are the warning fallback, not members', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const p = window.prism as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
      for (const verb of ['writeText', 'archiveDelete', 'archiveRename', 'archiveAdd', 'renameFile']) {
        await expect(p[verb]('x')).resolves.toBe(false)
      }
      expect(warn).toHaveBeenCalledTimes(5)
      warn.mockRestore()
    })
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
