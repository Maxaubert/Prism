import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { request } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import type { MediaInfo } from '../ffmpeg'
import type { TextRead } from '@shared/types'
import { HlsJobs } from './jobs'
import { emptyState, forget } from './pairing'
import { PhoneServer, type PhoneDeps } from './server'
import { fakeFfmpeg } from './testing/fakeFfmpeg'

/**
 * The server over real loopback http: every route the phone page will call,
 * the wall in front of each, and pairing's single use and rate limit. The
 * deps are stubs so nothing here reaches main's real listing or fsmedia.
 */

let dir: string
let renderer: string
/** A picture OUTSIDE the phone's root, that only a grant can let through. */
let picOutside: string
/** What the text route handed main's own servable set. */
let servable: string[]
let server: PhoneServer
let port: number
let changes = 0
/** The server holds this object, so a test can swap one dep for a failing one. */
let deps: PhoneDeps

/** What main's cached probe would say: the same h264 picture in both files,
 *  AAC in the mp4 and Dolby in the mkv, and nothing for a file that is not there. */
const probeOf = (p: string): MediaInfo | null => {
  const name = p.toLowerCase()
  if (!name.endsWith('clip.mp4') && !name.endsWith('clip.mkv')) return null
  const codec = name.endsWith('.mkv') ? 'ac3' : 'aac'
  const audio = { index: 1, title: '', codec, channels: 2, layout: 'stereo', language: 'eng', duration: 10 }
  return {
    audio,
    tracks: [audio],
    videoCodec: 'h264',
    video: { width: 1920, height: 1080, pixFmt: 'yuv420p', transfer: 'bt709' },
    fps: 24,
    duration: 10
  }
}

const listing = (files: string[]) => ({
  folders: [],
  files: files.map((f) => ({
    path: join(dir, f),
    name: f,
    ext: '.mp4',
    kind: 'video' as const,
    size: 4,
    mtimeMs: 0
  }))
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'prism-phone-'))
  renderer = join(dir, 'renderer')
  mkdirSync(join(renderer, 'assets'), { recursive: true })
  writeFileSync(join(renderer, 'phone.html'), '<html>phone</html>')
  writeFileSync(join(renderer, 'assets', 'a.js'), 'console.log(1)')
  writeFileSync(join(dir, 'clip.mp4'), 'abcd')
  writeFileSync(join(dir, 'clip.mkv'), 'abcd')
  const outside = mkdtempSync(join(tmpdir(), 'prism-phone-outside-'))
  picOutside = join(outside, 'pic.png')
  writeFileSync(picOutside, 'png')
  servable = []
  deps = {
    rendererDir: renderer,
    media: async (req) => {
      const p = decodeURIComponent(new URL(req.url).pathname).slice(1)
      const range = req.headers.get('range')
      if (range) return new Response('bc', { status: 206, headers: { 'Content-Range': 'bytes 1-2/4' } })
      // The wall under test is the SERVER's; serveMedia is faked, and it
      // answers for the picture outside the root as it would once main
      // had it in its servable set.
      const ok = p.endsWith('clip.mp4') || p.endsWith('pic.png')
      return new Response(ok ? 'abcd' : null, { status: ok ? 200 : 404 })
    },
    listDir: async () => listing(['clip.mp4']),
    validRoot: (root, p) => root === dir && p.toLowerCase().startsWith(dir.toLowerCase()),
    isRoot: (root, p) => root === dir && p === dir,
    rootOpen: (root) => root === dir,
    subsFor: () => [{ path: join(dir, 'clip.srt'), label: 'English' }],
    readSubs: async () => 'WEBVTT\n',
    probe: async (p) => probeOf(p),
    readText: async (p): Promise<TextRead> =>
      p.endsWith('.md') ? { text: '![x](pic.png)' } : p.endsWith('.bin') ? { error: 'unreadable' } : { text: 'hello' },
    docHtml: async (p) => (p.endsWith('.docx') ? '<p>doc</p>' : null),
    docImages: () => [picOutside],
    isMarkdown: (p) => p.endsWith('.md'),
    grantServable: (paths) => {
      servable.push(...paths)
    },
    // A real HlsJobs on the fake ffmpeg: the routes are the thing under test,
    // and a stubbed jobs class would only prove the stub.
    jobs: new HlsJobs({ ffmpeg: 'f', baseDir: join(dir, 'hls'), spawn: fakeFfmpeg().spawn }),
    onChange: () => {
      changes += 1
    },
    loopbackOnly: true,
    now: () => 1000
  }
  server = new PhoneServer(deps, emptyState())
  port = await server.start(0)
})

afterEach(async () => {
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
  rmSync(join(picOutside, '..'), { recursive: true, force: true })
})

const url = (p: string) => `http://127.0.0.1:${port}${p}`

/**
 * `fetch` resolves dot segments BEFORE the request leaves, so a climb sent
 * through it arrives as the plain path it climbs to. The raw request line is
 * what a hand-written client (or curl --path-as-is) sends, and what the
 * server must refuse on its own.
 */
function rawStatus(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    r.on('error', reject)
    r.end()
  })
}

async function pair(): Promise<string> {
  const { code } = server.issue(dir)
  const r = await fetch(url('/pair'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name: 'Test phone' })
  })
  expect(r.status).toBe(200)
  const j = (await r.json()) as { token: string; root: string }
  expect(j.root).toBe(dir)
  return j.token
}

describe('PhoneServer', () => {
  it('serves the page and its assets, and nothing above the renderer dir', async () => {
    expect(await (await fetch(url('/'))).text()).toBe('<html>phone</html>')
    expect(await (await fetch(url('/?code=ABC'))).text()).toBe('<html>phone</html>')
    expect((await fetch(url('/assets/a.js'))).status).toBe(200)
    // A climb that resolves to the index page is the index page, which is
    // public anyway; one that lands ABOVE the renderer dir is refused.
    expect(await rawStatus('/assets/../../clip.mp4')).toBe(404)
    expect(await rawStatus('/assets/..%2F..%2Fclip.mp4')).toBe(404)
    expect(await rawStatus('/..%5Cclip.mp4')).toBe(404)
    expect((await fetch(url('/assets/missing.js'))).status).toBe(404)
  })

  it('pairs once and refuses a spent code', async () => {
    const token = await pair()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(changes).toBeGreaterThan(0)
    const { code } = server.issue(dir)
    const first = await fetch(url('/pair'), { method: 'POST', body: JSON.stringify({ code, name: 'x' }) })
    expect(first.status).toBe(200)
    const again = await fetch(url('/pair'), { method: 'POST', body: JSON.stringify({ code, name: 'x' }) })
    expect(again.status).toBe(403)
  })

  it('refuses a pair that is not a POST, or not JSON', async () => {
    expect((await fetch(url('/pair'))).status).toBe(405)
    expect((await fetch(url('/pair'), { method: 'POST', body: 'soup' })).status).toBe(400)
    expect((await fetch(url('/pair'), { method: 'POST', body: '{"name":"x"}' })).status).toBe(400)
  })

  it('answers 413 to an oversized pair body instead of dropping the socket', async () => {
    const body = JSON.stringify({ code: 'ABCDEF', name: 'x'.repeat(8000) })
    const r = await fetch(url('/pair'), { method: 'POST', body })
    expect(r.status).toBe(413)
    expect(await r.json()).toEqual({ error: 'too large' })
  })

  it('a paired phone scanning another code keeps its token and moves root', async () => {
    const token = await pair()
    const { code } = server.issue(dir) // stands in for another tab's root
    const r = await fetch(url('/pair'), {
      method: 'POST',
      body: JSON.stringify({ code, name: 'Test phone', token })
    })
    expect(r.status).toBe(200)
    expect(((await r.json()) as { token: string }).token).toBe(token)
    expect(server.state.phones).toHaveLength(1)
  })

  it('walls every api route behind the token', async () => {
    expect((await fetch(url('/api/me'))).status).toBe(401)
    expect((await fetch(url(`/api/dir?path=${encodeURIComponent(dir)}`))).status).toBe(401)
    expect((await fetch(url(`/m/${encodeURIComponent(join(dir, 'clip.mp4'))}`))).status).toBe(401)
    expect((await fetch(url('/api/me'), { headers: { authorization: 'Bearer nope' } })).status).toBe(401)
  })

  it('answers me, dir, subs and media for a paired phone', async () => {
    const token = await pair()
    const auth = { authorization: `Bearer ${token}` }
    const me = (await (await fetch(url('/api/me'), { headers: auth })).json()) as {
      root: string
      open: boolean
      name: string
    }
    expect(me).toEqual({ root: dir, open: true, name: 'Test phone' })
    const d = (await (
      await fetch(url(`/api/dir?path=${encodeURIComponent(dir)}`), { headers: auth })
    ).json()) as { files: unknown[] }
    expect(d.files).toHaveLength(1)
    const subs = (await (
      await fetch(url(`/api/subs?path=${encodeURIComponent(join(dir, 'clip.mp4'))}`), { headers: auth })
    ).json()) as unknown[]
    expect(subs).toHaveLength(1)
    const vtt = await (
      await fetch(url(`/api/subs/read?path=${encodeURIComponent(join(dir, 'clip.srt'))}`), { headers: auth })
    ).text()
    expect(vtt).toBe('WEBVTT\n')
    const m = await fetch(url(`/m/${encodeURIComponent(join(dir, 'clip.mp4'))}?t=${token}`))
    expect(m.status).toBe(200)
    expect(await m.text()).toBe('abcd')
    const r = await fetch(url(`/m/${encodeURIComponent(join(dir, 'clip.mp4'))}?t=${token}`), {
      headers: { range: 'bytes=1-2' }
    })
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe('bytes 1-2/4')
    expect(server.watching()).toEqual([token])
    expect((await fetch(url('/api/nope'), { headers: auth })).status).toBe(404)
  })

  const api = (token: string, name: string, file: string): Promise<Response> =>
    fetch(url(`/api/${name}?path=${encodeURIComponent(join(dir, file))}`), {
      headers: { authorization: `Bearer ${token}` }
    })

  it('reads text and grants a markdown its own pictures to this phone only', async () => {
    const a = await pair()
    const b = await pair()
    const t = await (await api(a, 'text', 'readme.md')).json()
    expect(t).toEqual({ text: '![x](pic.png)' })
    // Main's own wall learned about the picture too, once.
    expect(servable).toEqual([picOutside])
    expect((await fetch(url(`/m/${encodeURIComponent(picOutside)}?t=${a}`))).status).toBe(200)
    expect((await fetch(url(`/m/${encodeURIComponent(picOutside)}?t=${b}`))).status).toBe(403)
    // Forgetting the phone takes its grants with it.
    server.dropGrants(a)
    expect((await fetch(url(`/m/${encodeURIComponent(picOutside)}?t=${a}`))).status).toBe(403)
  })

  it('a plain text file grants nothing, and an unreadable one says so', async () => {
    const a = await pair()
    expect(await (await api(a, 'text', 'notes.txt')).json()).toEqual({ text: 'hello' })
    expect(servable).toEqual([])
    expect((await fetch(url(`/m/${encodeURIComponent(picOutside)}?t=${a}`))).status).toBe(403)
    expect(await (await api(a, 'text', 'blob.bin')).json()).toEqual({ error: 'unreadable' })
  })

  it('converts a document, and 404s one it cannot', async () => {
    const a = await pair()
    const d = await api(a, 'doc', 'a.docx')
    expect(d.status).toBe(200)
    expect(await d.json()).toEqual({ html: '<p>doc</p>' })
    expect((await api(a, 'doc', 'a.xyz')).status).toBe(404)
  })

  it('walls text and doc behind the token and the root', async () => {
    expect((await fetch(url(`/api/text?path=${encodeURIComponent(join(dir, 'readme.md'))}`))).status).toBe(401)
    expect((await fetch(url(`/api/doc?path=${encodeURIComponent(join(dir, 'a.docx'))}`))).status).toBe(401)
    const a = await pair()
    const auth = { authorization: `Bearer ${a}` }
    expect((await fetch(url('/api/text?path=C%3A%5CWindows%5Creadme.md'), { headers: auth })).status).toBe(403)
    expect((await fetch(url('/api/doc?path=C%3A%5CWindows%5Ca.docx'), { headers: auth })).status).toBe(403)
    // A markdown outside the root grants nothing on the way to its 403.
    expect(servable).toEqual([])
    expect((await fetch(url(`/m/${encodeURIComponent(picOutside)}?t=${a}`))).status).toBe(403)
  })

  it('refuses a path outside the phone root, even for a paired phone', async () => {
    const token = await pair()
    const auth = { authorization: `Bearer ${token}` }
    expect((await fetch(url('/api/dir?path=C%3A%5CWindows'), { headers: auth })).status).toBe(403)
    expect((await fetch(url('/api/subs?path=C%3A%5CWindows%5Ca.mp4'), { headers: auth })).status).toBe(403)
    expect((await fetch(url('/m/C%3A%5CWindows%5Cnotepad.exe'), { headers: auth })).status).toBe(403)
  })

  const play = (token: string, file: string, can = 'h264,aac,mp4'): Promise<Record<string, unknown>> =>
    fetch(url(`/api/play?path=${encodeURIComponent(join(dir, file))}&can=${can}`), {
      headers: { authorization: `Bearer ${token}` }
    }).then((r) => r.json() as Promise<Record<string, unknown>>)

  it('/api/play answers direct for an mp4 the phone plays and hls for an mkv', async () => {
    const token = await pair()
    const direct = await play(token, 'clip.mp4')
    expect(direct).toMatchObject({ mode: 'direct', fps: 24, duration: 10 })
    expect(direct.url).toContain('/m/')
    expect(direct.url).toContain(`t=${token}`)

    const hls = await play(token, 'clip.mkv')
    expect(hls).toMatchObject({ mode: 'hls', copyVideo: true, audioOnly: false, fps: 24, duration: 10 })
    const playlistUrl = String(hls.url)
    expect(playlistUrl).toMatch(/^\/hls\/[0-9a-f]{16}\/index\.m3u8\?t=/)

    const pl = await fetch(url(playlistUrl))
    expect(pl.status).toBe(200)
    expect(pl.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
    expect(pl.headers.get('cache-control')).toBe('no-store')
    const text = await pl.text()
    // The player resolves each uri against the playlist's and drops its
    // query, so the token has to be ON the uris or every segment is a 401.
    expect(text).toContain(`#EXT-X-MAP:URI="init.mp4?t=${token}"`)
    expect(text).toContain(`2.m4s?t=${token}`)
    expect(text).not.toContain('3.m4s') // ten seconds is three segments

    const seg = await fetch(url(playlistUrl.replace('index.m3u8', '1.m4s')))
    expect(seg.status).toBe(200)
    expect(seg.headers.get('content-type')).toBe('video/iso.segment')
    expect(seg.headers.get('cache-control')).toBe('no-store')
    expect(await seg.text()).toBe('seg1')

    const init = await fetch(url(playlistUrl.replace('index.m3u8', 'init.mp4')))
    expect(init.status).toBe(200)
    expect(init.headers.get('content-type')).toBe('video/mp4')
    expect(await init.text()).toBe('init')

    // Past the end of the film: not a segment the playlist names.
    const past = await fetch(url(playlistUrl.replace('index.m3u8', '9.m4s')))
    expect(past.status).toBe(404)
    expect(await past.json()).toMatchObject({ error: expect.any(String) })

    // Asking again for the same file is the same job, not a second ffmpeg.
    expect((await play(token, 'clip.mkv')).url).toBe(playlistUrl)
  })

  it('/api/play is walled and needs a probe', async () => {
    const token = await pair()
    const auth = { authorization: `Bearer ${token}` }
    expect((await fetch(url('/api/play?path=C%3A%5CWindows%5Cx.mkv&can=h264'), { headers: auth })).status).toBe(403)
    expect((await fetch(url(`/api/play?path=${encodeURIComponent(join(dir, 'clip.mkv'))}`))).status).toBe(401)
    const none = await play(token, 'nothing.mkv', 'h264')
    expect(none).toMatchObject({ mode: 'none', reason: expect.any(String) })
  })

  it('/api/play says none, with a reason, when there is no ffmpeg to convert with', async () => {
    const token = await pair()
    deps.jobs = null
    expect(await play(token, 'clip.mp4')).toMatchObject({ mode: 'direct' })
    const none = await play(token, 'clip.mkv')
    expect(none).toMatchObject({ mode: 'none' })
    expect(String(none.reason)).toContain('ffmpeg')
  })

  it('an hls job belongs to the phone that opened it', async () => {
    const a = await pair()
    const hls = await play(a, 'clip.mkv', 'h264')
    const playlistUrl = String(hls.url)
    const b = await pair()
    const other = playlistUrl.replace(/t=.*$/, `t=${b}`)
    // 404 and never 403: another phone is not told the job exists.
    expect((await fetch(url(other))).status).toBe(404)
    expect((await fetch(url(other.replace('index.m3u8', '1.m4s')))).status).toBe(404)
    expect((await fetch(url(other.replace('index.m3u8', 'init.mp4')))).status).toBe(404)
    // No token at all is the wall, as for every other route.
    expect((await fetch(url(playlistUrl.replace(/\?t=.*$/, '')))).status).toBe(401)
    // A job id nobody opened, from a paired phone: the same 404.
    expect((await fetch(url(`/hls/0123456789abcdef/index.m3u8?t=${a}`))).status).toBe(404)
  })

  it('stopping the server stops every hls job and removes its directory', async () => {
    const token = await pair()
    const hls = await play(token, 'clip.mkv')
    const playlistUrl = String(hls.url)
    expect((await fetch(url(playlistUrl.replace('index.m3u8', '0.m4s')))).status).toBe(200)
    const jobDir = join(dir, 'hls', playlistUrl.split('/')[2])
    expect(existsSync(jobDir)).toBe(true)
    await server.stop()
    expect(existsSync(jobDir)).toBe(false)
  })

  /**
   * A route that THROWS is a status and a reason, never a hung request. The
   * routes are `return await`ed inside handle's try; without the await a
   * returned promise is adopted after the try has exited and its rejection
   * escapes the catch, which is a phone waiting forever and an unhandled
   * rejection in main. Every route kind that can reject is driven here.
   */
  it('turns a failing route into a 500 with a reason, and no unhandled rejection', async () => {
    let unhandled = 0
    const onUnhandled = (): void => {
      unhandled += 1
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const token = await pair()
      const auth = { authorization: `Bearer ${token}` }
      deps.listDir = async () => {
        throw new Error('listing exploded')
      }
      const d = await fetch(url(`/api/dir?path=${encodeURIComponent(dir)}`), {
        headers: auth,
        signal: AbortSignal.timeout(3000)
      })
      expect(d.status).toBe(500)
      expect(await d.json()).toEqual({ error: 'listing exploded' })

      deps.readSubs = async () => {
        throw new Error('ffmpeg exploded')
      }
      const s = await fetch(url(`/api/subs/read?path=${encodeURIComponent(join(dir, 'clip.srt'))}`), {
        headers: auth,
        signal: AbortSignal.timeout(3000)
      })
      expect(s.status).toBe(500)
      expect(await s.json()).toEqual({ error: 'ffmpeg exploded' })

      deps.media = async () => {
        throw new Error('media exploded')
      }
      const m = await fetch(url(`/m/${encodeURIComponent(join(dir, 'clip.mp4'))}?t=${token}`), {
        signal: AbortSignal.timeout(3000)
      })
      expect(m.status).toBe(500)
      expect(await m.json()).toEqual({ error: 'media exploded' })

      // The dev proxy with vite down: a refused connection, not a hung page.
      deps.devUrl = 'http://127.0.0.1:1/'
      const p = await fetch(url('/'), { signal: AbortSignal.timeout(3000) })
      expect(p.status).toBe(500)
      expect(((await p.json()) as { error: string }).error).toBeTruthy()
      deps.devUrl = undefined

      // Let anything that escaped surface before the count is read.
      await new Promise((r) => setTimeout(r, 20))
      expect(unhandled).toBe(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('stops listing a forgotten phone as watching', async () => {
    const token = await pair()
    await fetch(url('/api/me'), { headers: { authorization: `Bearer ${token}` } })
    expect(server.watching()).toEqual([token])
    forget(server.state, token)
    expect(server.watching()).toEqual([])
  })

  it('rate-limits pairing attempts', async () => {
    for (let i = 0; i < 5; i++)
      await fetch(url('/pair'), { method: 'POST', body: JSON.stringify({ code: 'ZZZZZZ', name: 'x' }) })
    const r = await fetch(url('/pair'), { method: 'POST', body: JSON.stringify({ code: 'ZZZZZZ', name: 'x' }) })
    expect(r.status).toBe(429)
  })

  it('stops, and answers nothing afterwards', async () => {
    await server.stop()
    expect(server.port).toBeNull()
    await expect(fetch(url('/'))).rejects.toThrow()
  })
})
