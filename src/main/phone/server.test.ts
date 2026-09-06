import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { request } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { emptyState } from './pairing'
import { PhoneServer, type PhoneDeps } from './server'

/**
 * The server over real loopback http: every route the phone page will call,
 * the wall in front of each, and pairing's single use and rate limit. The
 * deps are stubs so nothing here reaches main's real listing or fsmedia.
 */

let dir: string
let renderer: string
let server: PhoneServer
let port: number
let changes = 0

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
  const deps: PhoneDeps = {
    rendererDir: renderer,
    media: async (req) => {
      const p = decodeURIComponent(new URL(req.url).pathname).slice(1)
      const range = req.headers.get('range')
      if (range) return new Response('bc', { status: 206, headers: { 'Content-Range': 'bytes 1-2/4' } })
      return new Response(p.endsWith('clip.mp4') ? 'abcd' : null, {
        status: p.endsWith('clip.mp4') ? 200 : 404
      })
    },
    listDir: async () => listing(['clip.mp4']),
    validRoot: (root, p) => root === dir && p.toLowerCase().startsWith(dir.toLowerCase()),
    isRoot: (root, p) => root === dir && p === dir,
    rootOpen: (root) => root === dir,
    subsFor: () => [{ path: join(dir, 'clip.srt'), label: 'English' }],
    readSubs: async () => 'WEBVTT\n',
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

  it('refuses a path outside the phone root, even for a paired phone', async () => {
    const token = await pair()
    const auth = { authorization: `Bearer ${token}` }
    expect((await fetch(url('/api/dir?path=C%3A%5CWindows'), { headers: auth })).status).toBe(403)
    expect((await fetch(url('/api/subs?path=C%3A%5CWindows%5Ca.mp4'), { headers: auth })).status).toBe(403)
    expect((await fetch(url('/m/C%3A%5CWindows%5Cnotepad.exe'), { headers: auth })).status).toBe(403)
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
