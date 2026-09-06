/**
 * The phone server (2026-09-06, #104): a plain Node http server on the LAN
 * that serves the phone page, pairs phones and answers the read-only routes
 * the page needs. The wall is written ONCE, at the top of `handle`: every
 * route but pairing and the static page needs a paired phone, and every
 * path is checked against THAT phone's root with the strict per-root check
 * before anything else looks at it. Bytes come from `serveMedia`, so the
 * media route inherits fsmedia's own rules on top.
 *
 * Nothing here is synchronous on main's thread: static files stream, the
 * listing is the bounded async one the sidebar uses, and pairing is a list
 * in memory. Under `--e2e` it binds loopback only, so a throwaway build
 * never raises the firewall prompt.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { createReadStream, promises as fsp } from 'fs'
import { join, extname, normalize } from 'path'
import { Readable } from 'stream'
import type { DirListing } from '@shared/types'
import { forget, issueCode, phoneFor, redeem, touch, type PairState } from './pairing'
import { parseRoute, tokenOf } from './routes'

export const DEFAULT_PORT = 47320
/** A phone counts as watching for this long after its last fetch. */
const WATCH_WINDOW_MS = 30_000
/** Pairing attempts allowed per address per window: a six-character code
 *  from a 32-letter alphabet is a billion possibilities, and five a minute
 *  makes guessing one a hobby rather than an attack. */
const PAIR_LIMIT = 5
const PAIR_WINDOW_MS = 60_000
/** How many ports above the preferred one are tried before giving up. */
const PORT_TRIES = 10

export interface PhoneDeps {
  /** Where the built phone bundle lives (`out/renderer`). */
  rendererDir: string
  /** ELECTRON_RENDERER_URL in dev: static paths are proxied to vite instead. */
  devUrl?: string
  /** `serveMedia`, the fsmedia:// handler: the bytes and their own wall. */
  media: (req: Request) => Promise<Response>
  /** The bounded async listing the sidebar uses. */
  listDir: (dir: string) => Promise<DirListing>
  /** The strict per-root check: is `p` inside `root`? */
  validRoot: (root: string, p: string) => boolean
  /** Is `p` the root itself? `validRoot` says no to that, and the phone lists it first. */
  isRoot: (root: string, p: string) => boolean
  /** Does a tab still hold this root? False is the phone's "scan again" screen. */
  rootOpen: (root: string) => boolean
  /** Sidecar subtitle tracks beside a media file. */
  subsFor: (p: string) => Array<{ path: string; label: string }>
  /** One sidecar as WebVTT; null when it cannot be read or converted. */
  readSubs: (p: string) => Promise<string | null>
  /** Pairing changed: persist and tell the dialog. */
  onChange: () => void
  loopbackOnly: boolean
  now?: () => number
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.bcmap': 'application/octet-stream'
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

/** The request body as text, refused past `max` bytes: pairing is a code and a name. */
function readBody(req: IncomingMessage, max = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export class PhoneServer {
  private server: Server | null = null
  private bound: number | null = null
  /** Token -> when it last fetched anything. */
  private seen = new Map<string, number>()
  /** Remote address -> the times it tried to pair inside the window. */
  private pairHits = new Map<string, number[]>()
  private readonly now: () => number

  constructor(
    private readonly deps: PhoneDeps,
    readonly state: PairState
  ) {
    this.now = deps.now ?? Date.now
  }

  get port(): number | null {
    return this.bound
  }

  /** Phones that fetched something in the last 30s. */
  watching(): string[] {
    const cutoff = this.now() - WATCH_WINDOW_MS
    return [...this.seen.entries()].filter(([, t]) => t >= cutoff).map(([tok]) => tok)
  }

  /** A fresh code for `root`, replacing any live one for the same root. */
  issue(root: string): { code: string; expires: number } {
    const code = issueCode(this.state, root, this.now())
    const expires = this.state.codes.find((c) => c.code === code)?.expires ?? this.now()
    return { code, expires }
  }

  /** Bind, trying the ten ports above the preferred one before giving up.
   *  Port 0 asks the OS for any free one and is never retried. */
  start(preferredPort: number): Promise<number> {
    const host = this.deps.loopbackOnly ? '127.0.0.1' : '0.0.0.0'
    const tryPort = (port: number, left: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const s = createServer((req, res) => void this.handle(req, res))
        s.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE' && left > 0 && port !== 0) resolve(tryPort(port + 1, left - 1))
          else reject(err)
        })
        s.listen(port, host, () => {
          this.server = s
          const addr = s.address()
          this.bound = typeof addr === 'object' && addr ? addr.port : port
          resolve(this.bound)
        })
      })
    return tryPort(preferredPort, PORT_TRIES)
  }

  /** Close, dropping open connections rather than waiting for a film to end. */
  stop(): Promise<void> {
    const s = this.server
    this.server = null
    this.bound = null
    if (!s) return Promise.resolve()
    return new Promise((resolve) => {
      s.closeAllConnections()
      s.close(() => resolve())
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const route = parseRoute(req.url ?? '/')
      if (route.kind === 'none') return void json(res, 404, { error: 'not found' })
      if (route.kind === 'static') return this.serveStatic(route.file, req, res)
      if (route.kind === 'pair') return this.pair(req, res)

      // THE WALL. Everything past here is a paired phone, and every path it
      // names is checked against the root it paired to, not against every
      // root the PC has open.
      const token = tokenOf(route.query, req.headers.authorization)
      const phone = phoneFor(this.state, token)
      if (!phone) return void json(res, 401, { error: 'not paired' })
      const now = this.now()
      touch(this.state, phone.token, now)
      this.seen.set(phone.token, now)

      if (route.kind === 'media') {
        if (!this.deps.validRoot(phone.root, route.path)) return void json(res, 403, { error: 'outside the folder' })
        return this.serveMedia(route.path, req, res)
      }
      return this.api(route.name, route.query, phone.root, phone.name, res)
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: String((err as Error)?.message ?? err) })
      else res.end()
    }
  }

  private async pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return void json(res, 405, { error: 'POST' })
    const from = req.socket.remoteAddress ?? '?'
    const now = this.now()
    const hits = (this.pairHits.get(from) ?? []).filter((t) => t > now - PAIR_WINDOW_MS)
    if (hits.length >= PAIR_LIMIT) return void json(res, 429, { error: 'too many attempts, wait a minute' })
    hits.push(now)
    this.pairHits.set(from, hits)
    let body: { code?: unknown; name?: unknown; token?: unknown }
    try {
      body = JSON.parse(await readBody(req)) as typeof body
    } catch {
      return void json(res, 400, { error: 'bad request' })
    }
    if (!body || typeof body !== 'object' || typeof body.code !== 'string') {
      return void json(res, 400, { error: 'no code' })
    }
    const phone = redeem(this.state, body.code, typeof body.name === 'string' ? body.name : 'Phone', now)
    if (!phone) return void json(res, 403, { error: 'that code is not valid any more; scan again' })
    // A phone that is ALREADY paired and scans a code from another tab MOVES
    // to that root (spec): it keeps its token and the list does not grow a
    // second entry for the same phone.
    const existing = phoneFor(this.state, typeof body.token === 'string' ? body.token : null)
    if (existing) {
      existing.root = phone.root
      existing.name = phone.name
      existing.seen = now
      forget(this.state, phone.token)
      this.deps.onChange()
      return void json(res, 200, { token: existing.token, root: existing.root })
    }
    this.deps.onChange()
    json(res, 200, { token: phone.token, root: phone.root })
  }

  private async api(
    name: string,
    q: URLSearchParams,
    root: string,
    phoneName: string,
    res: ServerResponse
  ): Promise<void> {
    const path = q.get('path') ?? ''
    const inside = (): boolean => this.deps.validRoot(root, path) || this.deps.isRoot(root, path)
    switch (name) {
      case 'me':
        return void json(res, 200, { root, open: this.deps.rootOpen(root), name: phoneName })
      case 'dir': {
        if (!inside()) return void json(res, 403, { error: 'outside the folder' })
        return void json(res, 200, await this.deps.listDir(path))
      }
      case 'subs': {
        if (!inside()) return void json(res, 403, { error: 'outside the folder' })
        return void json(res, 200, this.deps.subsFor(path))
      }
      case 'subs/read': {
        if (!inside()) return void json(res, 403, { error: 'outside the folder' })
        const vtt = await this.deps.readSubs(path)
        if (vtt === null) return void json(res, 404, { error: 'no subtitles' })
        res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'no-store' })
        return void res.end(vtt)
      }
      default:
        return void json(res, 404, { error: 'no such route' })
    }
  }

  /** Bytes through serveMedia: same handler as fsmedia://, same rules. */
  private async serveMedia(path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const headers: Record<string, string> = {}
    if (req.headers.range) headers.range = String(req.headers.range)
    const r = await this.deps.media(new Request(`fsmedia://local/${encodeURIComponent(path)}`, { headers }))
    const out: Record<string, string> = { 'cache-control': 'no-store' }
    r.headers.forEach((v, k) => {
      if (k.toLowerCase() !== 'access-control-allow-origin') out[k] = v
    })
    res.writeHead(r.status, out)
    if (!r.body) return void res.end()
    const node = Readable.fromWeb(r.body as never)
    node.on('error', () => res.destroy())
    res.on('close', () => node.destroy())
    node.pipe(res)
  }

  /** The phone bundle out of the renderer dir; in dev, out of vite's server. */
  private async serveStatic(file: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.deps.devUrl) {
      const target = new URL(file ? `/${file}` : '/phone.html', this.deps.devUrl)
      const r = await fetch(target, { headers: { accept: String(req.headers.accept ?? '*/*') } })
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream' })
      if (!r.body) return void res.end()
      Readable.fromWeb(r.body as never).pipe(res)
      return
    }
    const rel = file || 'phone.html'
    const base = normalize(this.deps.rendererDir)
    const full = normalize(join(base, rel))
    // The parser already refused a climb; this is the belt to that brace.
    if (!full.toLowerCase().startsWith(base.toLowerCase())) return void json(res, 404, { error: 'not found' })
    let st: Awaited<ReturnType<typeof fsp.stat>>
    try {
      st = await fsp.stat(full)
    } catch {
      return void json(res, 404, { error: 'not found' })
    }
    if (!st.isFile()) return void json(res, 404, { error: 'not found' })
    res.writeHead(200, {
      'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(st.size),
      // Vite hashes its asset names, so those can be cached forever; the page
      // itself is re-validated so a new build shows up on the next open.
      'cache-control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    })
    const s = createReadStream(full)
    s.on('error', () => res.destroy())
    s.pipe(res)
  }
}
