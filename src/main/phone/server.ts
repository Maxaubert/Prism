/**
 * The phone server (2026-09-06, #104): a plain Node http server on the LAN
 * that serves the phone page, pairs phones and answers the read-only routes
 * the page needs. The wall is written ONCE, at the top of `handle`: every
 * route but pairing and the static page needs a paired phone, and every
 * path it names is checked against what THAT phone may read before anything
 * else looks at it. Bytes come from `serveMedia`, so the media route inherits
 * fsmedia's own rules on top. The one softening (#106) is a PER-PHONE grant
 * (`grants.ts`): a file an answer to THIS phone produced, such as a picture
 * its markdown names elsewhere, may be fetched by this phone and by no other,
 * and it is gone when the phone is forgotten.
 *
 * The wall has WIDENED twice. 2026-09-08 (#107): from one tab's root to any
 * root the PC had open. 2026-10-14 (owner: "basically just on the explorer,
 * meaning youre not tied down to a specific project"; asked, "the whole PC,
 * like Explorer"): to every LOCAL folder this Windows user can read, by the
 * desktop Explorer's own rule (`phoneAccess.ts`). Listing a folder grants it
 * to this phone; a file is readable when it sits directly in a folder this
 * phone listed. Still paired, still the user's own network, still read-only.

 * Nothing here is synchronous on main's thread: static files stream, the
 * listing is the bounded async one the sidebar uses, and pairing is a list
 * in memory. Under `--e2e` it binds loopback only, so a throwaway build
 * never raises the firewall prompt.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { createReadStream, promises as fsp } from 'fs'
import { basename, dirname, join, extname, normalize } from 'path'
import { Readable } from 'stream'
import type {
  ArchiveListing,
  DirListing,
  FileMemory,
  FileMemoryPatch,
  SearchResult,
  TextRead
} from '@shared/types'
import type { MemberExtractResult } from '@shared/extraction'
import type { SubtitleTrack } from '@shared/ipcTypes'
import {
  ROUTE,
  hlsPlaylistPath,
  mediaPath,
  type DocAnswer,
  type Me,
  type PairAnswer,
  type PhoneStat,
  type PlacesAnswer,
  type PlayAnswer,
  type PosAnswer
} from '@shared/phoneWire'
import type { ComicOpen } from '../comic'
import type { MediaInfo } from '../ffmpeg'
import { decide, parseCan } from './decide'
import { Grants } from './grants'
import type { HlsJobs } from './jobs'
import { forget, issueCode, phoneFor, redeem, touch, type PairState, type Phone } from './pairing'
import { diagLines } from './diag'
import { memoryPatch } from './memory'
import { parseRoute, tokenOf, type Route } from './routes'
import { localPath } from './phoneAccess'
import { localNetwork } from './lan'
import { HLS_MIME, assetMime } from '../mime'

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
/** How often idle HLS jobs are looked for; a job is idle after 30s. */
const REAP_MS = 10_000
/** A phone walking folders saves where it is at most this often. */
const HERE_SAVE_MS = 2000

/** What a paired phone may read (`phoneAccess.ts`), handed in so a test can
 *  hold the same rule over its own temp folders. */
export interface PhoneAccess {
  /** The phone listed `dir`: the folder and its direct entries are its now. */
  listed: (token: string, dir: string) => void
  /** A folder this phone listed, or a direct entry of one. */
  may: (token: string, p: string) => boolean
  /** A forgotten phone keeps nothing. */
  release: (token: string) => void
  /** Really on this PC: never a mapped network drive or a link to a share
   *  (`phoneOnThisPc`). Asked before a folder is listed and before any read. */
  local: (p: string) => Promise<boolean>
}
export interface PhoneDeps {
  /** Where the built phone bundle lives (`out/renderer`). */
  rendererDir: string
  /** ELECTRON_RENDERER_URL in dev: static paths are proxied to vite instead. */
  devUrl?: string
  /** `serveMedia`, the fsmedia:// handler: the bytes and their own wall. */
  media: (req: Request) => Promise<Response>
  /** The bounded async listing the sidebar uses. */
  listDir: (dir: string) => Promise<DirListing>
  /** The sidebar's own `searchFiles`, over the folder the phone is IN and
   *  everything below it, as the Explorer's search box does. The operator
   *  grammar (`shared/searchQuery`) is the desktop's, taught in one place. */
  search: (dir: string, query: string) => Promise<SearchResult>
  /** What a paired phone may read: the desktop Explorer's rule, per phone. */
  access: PhoneAccess
  /** The Explorer's places: Quick access (Known Folders and the user's pins)
   *  and This PC's drives with their usage. */
  places: () => Promise<PlacesAnswer>
  /** Sidecar subtitle tracks beside a media file. */
  subsFor: (p: string) => Promise<SubtitleTrack[]>
  /** One sidecar as WebVTT; null when it cannot be read or converted. */
  readSubs: (p: string) => Promise<string | null>
  /** Main's cached probe: what the file holds, or null when ffprobe could
   *  not read it (or there is no ffprobe). `/api/play` decides from it. */
  probe: (file: string) => Promise<MediaInfo | null>
  /** The HLS jobs, one ffmpeg per phone and file; null when Prism found no
   *  ffmpeg, in which case a file the phone cannot play directly is `none`. */
  jobs: HlsJobs | null
  /** Main's `file:text` body, factored (#106): the text with its encoding
   *  remembered, or a reason. The wall is the route's, not this function's. */
  readText: (p: string) => Promise<TextRead>
  /** An office or ebook document converted AND sanitised in main; null when
   *  it is not one, or the conversion failed. */
  docHtml: (p: string) => Promise<string | null>
  /** The local pictures a markdown names (`documentImages`): what the
   *  phone that read it is granted. */
  docImages: (p: string, text: string) => Promise<string[]>
  isMarkdown: (p: string) => boolean
  /** Main's own media wall has to learn the same pictures: `/m/` goes
   *  through `serveMedia`, which checks its `servable` set on top of this
   *  server's grant. The two are granted side by side, from one call. */
  grantServable: (paths: string[]) => void
  /** Main's `comic:open` body, factored (#106): the book unpacked ONCE under
   *  userData and its pages in reading order, with the directory they sit
   *  in, which is what the phone is granted. Its failures come back in the
   *  same shape the IPC answers, so the shim is a plain fetch. */
  comicOpen: (
    p: string,
    password: string
  ) => Promise<ComicOpen | { error: 'password' | 'failed' | 'empty' }>
  /** Main's `archive:list` body: adm-zip or 7-Zip, main's choice. */
  archiveList: (p: string, password?: string) => Promise<ArchiveListing>
  /** Main's `archive:extract` body: one member to a temp file main grants
   *  its own wall; the phone's grant is this server's, beside it. */
  archiveExtract: (p: string, entry: string, password?: string) => Promise<MemberExtractResult>
  /** The kind gates the IPC handlers apply (`archiveReadOk`, `comicOk`):
   *  a .txt must never be handed to 7-Zip because a phone asked. */
  isArchive: (p: string) => boolean
  isComic: (p: string) => boolean
  /** Pairing changed: persist and tell the dialog. */
  onChange: () => void
  /** The phone log (`diag.ts`): the server's own timeline (play answers,
   *  refused streams) and, through `/api/diag`, what the phone's player
   *  saw. Optional so a test server without one logs nowhere. */
  log?: (line: string) => void
  /** A thumbnail for the phone's grid (#135): the JPEG main made, or null
   *  when the file cannot be thumbnailed. Main decides the kind and the
   *  cache; the route decides the wall. */
  thumb: (path: string) => Promise<string | null>
  /** The PC's own position store (#118): seconds into a film by path. The
   *  one thing a phone WRITES, and it writes a number into main's store,
   *  never the filesystem. Walled like every path the phone names. */
  positions: {
    get: (path: string) => Promise<FileMemory | null>
    set: (path: string, patch: FileMemoryPatch) => void
  }
  loopbackOnly: boolean
  now?: () => number
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(text)
}

/** Thrown by `readBody` past the cap; the route turns it into a 413. */
class TooLarge extends Error {
  constructor() {
    super('too large')
  }
}

/** The request body as text, refused past `max` bytes: pairing is a code and
 *  a name. The socket is NOT destroyed on an oversized body: tearing it down
 *  here would drop the 413 the route is about to write, and the phone would
 *  see a dead connection rather than a reason. The rest of the body is
 *  drained instead, and Node closes the connection after the reply. */
function readBody(req: IncomingMessage, max = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    let over = false
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      if (over) return
      size += c.length
      if (size > max) {
        over = true
        chunks.length = 0
        reject(new TooLarge())
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
  /** Looks for idle HLS jobs while the server is up. */
  private reaper: ReturnType<typeof setInterval> | null = null
  /** What each phone's answers have let it fetch past its folders (#106):
   *  a markdown's pictures, a comic's page directory and an extracted
   *  member. Consulted by the media route beside `access.may`, never instead. */
  private grants = new Grants()
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

  /** Phones that fetched something in the last 30s. Filtered against the
   *  pairing list rather than pruned on forget: `forget` is called from main
   *  and this server never hears about it, so a phone the dialog just
   *  dropped would otherwise stay "watching" for up to 30s more. */
  watching(): string[] {
    const cutoff = this.now() - WATCH_WINDOW_MS
    return [...this.seen.entries()]
      .filter(([tok, t]) => t >= cutoff && phoneFor(this.state, tok) !== null)
      .map(([tok]) => tok)
  }

  /** A forgotten phone's grants go with it: main calls this from
   *  `phone:forget`, since `forget` itself is pairing's and this server
   *  never hears about it otherwise. */
  dropGrants(token: string): void {
    this.grants.drop(token)
    this.deps.access.release(token)
    void this.deps.jobs?.stopFor(token)
  }

  /** A fresh code that starts a phone at `start` (null: This PC), replacing
   *  any live one for the same folder. */
  issue(start: string | null): { code: string; expires: number } {
    const code = issueCode(this.state, start, this.now())
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
          if (err.code === 'EADDRINUSE' && left > 0 && port !== 0)
            resolve(tryPort(port + 1, left - 1))
          else reject(err)
        })
        s.listen(port, host, () => {
          this.server = s
          const addr = s.address()
          this.bound = typeof addr === 'object' && addr ? addr.port : port
          // A job nobody asks about is an ffmpeg encoding for no one: the
          // jobs class knows which, and this is the clock that asks it.
          if (this.deps.jobs && !this.reaper) {
            this.reaper = setInterval(() => void this.deps.jobs?.reap(), REAP_MS)
            this.reaper.unref()
          }
          resolve(this.bound)
        })
      })
    return tryPort(preferredPort, PORT_TRIES)
  }

  /** Close, dropping open connections rather than waiting for a film to
   *  end, and every ffmpeg with them: a segment nobody can fetch is not
   *  worth encoding. */
  async stop(): Promise<void> {
    const s = this.server
    this.server = null
    this.bound = null
    if (this.reaper) {
      clearInterval(this.reaper)
      this.reaper = null
    }
    if (this.hereTimer) {
      clearTimeout(this.hereTimer)
      this.hereTimer = null
      this.deps.onChange()
    }
    await this.deps.jobs?.stopAll()
    if (!s) return
    await new Promise<void>((resolve) => {
      s.closeAllConnections()
      s.close(() => resolve())
    })
  }

  /**
   * Every route is `return await`ed, and that is not style: a promise RETURNED
   * from inside a try block is adopted after the block has exited, so its
   * rejection sails past the catch, the phone waits on a reply that never
   * comes and main logs an unhandled rejection. The rule is a status and a
   * one-line reason, never a blank page, and the await is what keeps it.
   */
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // The user's own network only (lan.ts): a forwarded port or a public
      // IPv6 address must not put pairing on the internet.
      if (!localNetwork(req.socket.remoteAddress)) return void json(res, 403, { error: 'not on this network' })
      const route = parseRoute(req.url ?? '/')
      if (route.kind === 'none') return void json(res, 404, { error: 'not found' })
      if (route.kind === 'static') return await this.serveStatic(route.file, req, res)
      if (route.kind === 'pair') return await this.pair(req, res)

      // THE WALL. Everything past here is a paired phone, and every path it
      // names is checked against what THIS phone may read.
      const token = tokenOf(route.query, req.headers.authorization)
      const phone = phoneFor(this.state, token)
      if (!phone) return void json(res, 401, { error: 'not paired' })
      const now = this.now()
      touch(this.state, phone.token, now)
      this.seen.set(phone.token, now)

      if (route.kind === 'media') {
        // A file in a folder this phone listed, or one its own answers granted it.
        const allowed =
          this.grants.has(phone.token, route.path) ||
          (this.deps.access.may(phone.token, route.path) && (await this.deps.access.local(route.path)))
        if (!allowed) return void json(res, 403, { error: 'outside the folder' })
        return await this.serveMedia(route.path, req, res)
      }
      if (route.kind === 'hls') return await this.hls(route, phone, res)
      return await this.api(route.name, route.query, phone, req, res)
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
    if (hits.length >= PAIR_LIMIT)
      return void json(res, 429, { error: 'too many attempts, wait a minute' })
    hits.push(now)
    this.pairHits.set(from, hits)
    let raw: string
    try {
      raw = await readBody(req)
    } catch (err) {
      if (err instanceof TooLarge) return void json(res, 413, { error: 'too large' })
      return void json(res, 400, { error: 'bad request' })
    }
    let body: { code?: unknown; name?: unknown; token?: unknown }
    try {
      body = JSON.parse(raw) as typeof body
    } catch {
      return void json(res, 400, { error: 'bad request' })
    }
    if (!body || typeof body !== 'object' || typeof body.code !== 'string') {
      return void json(res, 400, { error: 'no code' })
    }
    const phone = redeem(
      this.state,
      body.code,
      typeof body.name === 'string' ? body.name : 'Phone',
      now
    )
    if (!phone) return void json(res, 403, { error: 'that code is not valid any more; scan again' })
    // A phone that is ALREADY paired and scans another code MOVES to that
    // code's folder: it keeps its token and the list does not grow a second
    // entry for the same phone.
    const existing = phoneFor(this.state, typeof body.token === 'string' ? body.token : null)
    if (existing) {
      existing.name = phone.name
      // The code made a second phone for what is one device; the one that
      // already has a token is the one that stays.
      forget(this.state, phone.token)
      existing.seen = now
      this.setHere(existing, phone.here)
      this.deps.onChange()
      return void json(res, 200, { token: existing.token, here: existing.here } satisfies PairAnswer)
    }
    this.deps.onChange()
    json(res, 200, { token: phone.token, here: phone.here } satisfies PairAnswer)
  }

  /** Where the phone is now, saved at most every HERE_SAVE_MS: a phone
   *  walking folders would otherwise write the store on every tap. */
  private hereTimer: ReturnType<typeof setTimeout> | null = null
  private setHere(phone: Phone, here: string | null): void {
    if (phone.here === here) return
    phone.here = here
    if (this.hereTimer) return
    this.hereTimer = setTimeout(() => {
      this.hereTimer = null
      this.deps.onChange()
    }, HERE_SAVE_MS)
    this.hereTimer.unref?.()
  }

  private async api(
    name: string,
    q: URLSearchParams,
    phone: Phone,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const { token } = phone
    const path = q.get('path') ?? ''
    // What this phone may name: a folder it listed or a direct entry of one.
    // A GRANT counts too: a member extracted out of an archive lives in temp,
    // and reading it is exactly what the phone asked for.
    const inside = async (): Promise<boolean> =>
      this.grants.has(token, path) ||
      (localPath(path) && this.deps.access.may(token, path) && (await this.deps.access.local(path)))
    switch (name) {
      // Direct or HLS, per file and per DEVICE: the phone reports what it
      // plays in `can` and `decide` is a lookup against it. The wall is
      // here, once: a job is only ever opened on a path that passed it, and
      // the job id is what the /hls routes are keyed by afterwards.
      case ROUTE.play: {
        if (!(await inside())) return void json(res, 403, { error: 'outside the folder' })
        const info = await this.deps.probe(path)
        const plan = decide(info, extname(path), parseCan(q.get('can')))
        if (plan.mode === 'direct') {
          return void json(res, 200, {
            mode: 'direct',
            url: `${mediaPath(path)}?t=${token}`,
            fps: info?.fps ?? null,
            duration: info?.duration ?? 0
          } satisfies PlayAnswer)
        }
        if (plan.mode === 'none') return void json(res, 200, plan)
        if (!this.deps.jobs || !info) {
          return void json(res, 200, {
            mode: 'none',
            reason: 'Prism has no ffmpeg to convert with'
          })
        }
        // A track the phone PICKED (#120): the phone has no sidecar decoder,
        // so a pick is a stream with that audio, which is a job of its own.
        // Only one of the file's own tracks is accepted; anything else is
        // refused rather than handed to ffmpeg as a stream index.
        const wantAudio = q.get('audio')
        let audioIndex = info.audio?.index ?? null
        if (wantAudio !== null && wantAudio !== '') {
          const picked = info.tracks.find((t) => String(t.index) === wantAudio)
          if (!picked) return void json(res, 400, { error: 'no such audio track' })
          audioIndex = picked.index
        }
        const { id } = this.deps.jobs.open({
          token,
          file: path,
          plan: audioIndex !== null && audioIndex !== (info.audio?.index ?? null) ? { ...plan, copyAudio: false } : plan,
          duration: info.duration,
          audioIndex
        })
        this.deps.log?.(
          `play "${phone.name}" ${basename(path)} -> job ${id} (${plan.copyVideo ? 'copy' : 'encode'} ${info.videoCodec ?? 'no'} video, ${plan.copyAudio ? 'copy' : 'encode'} ${info.audio?.codec ?? 'no'} audio, ${Math.round(info.duration)}s, can=${q.get('can') ?? ''})`
        )
        return void json(res, 200, {
          mode: 'hls',
          url: `${hlsPlaylistPath(id)}?t=${token}`,
          copyVideo: plan.copyVideo,
          // The phone hands an audio-only playlist to its <audio> as the
          // source and a film to the video's convert path (Task 6).
          audioOnly: plan.audioOnly,
          fps: info.fps,
          duration: info.duration,
          // Every track the file holds and which one this stream carries,
          // so the phone's picker can offer the rest.
          tracks: info.tracks.map((t) => ({
            index: t.index,
            codec: t.codec,
            channels: t.channels,
            language: t.language,
            title: t.title
          })),
          audio: audioIndex
        } satisfies PlayAnswer)
      }
      // `name` is the PHONE's, as the PC lists it; `here` is the folder it
      // was last in, which is where the page opens (null: This PC).
      case ROUTE.me:
        return void json(res, 200, { name: phone.name, here: phone.here } satisfies Me)
      // The drawer and the This PC page: the Explorer's own places, read on
      // the ask (a drive can come and go). `here=1` is the page being SHOWN,
      // which makes This PC where the phone is.
      case ROUTE.places: {
        if (q.get('here') === '1') this.setHere(phone, null)
        return void json(res, 200, await this.deps.places())
      }
      // The phone's half of the diagnostics log (2026-09-12): a handful of
      // short lines from its player, written beside the server's own
      // timeline under the phone's name. Capped by `diagLines`, and the
      // body by `readBody`; a phone cannot fill the disk with it.
      // Where the film had got to (#118), read and written by path: a film
      // left at minute 40 on the PC opens at minute 40 on the phone, and the
      // place the phone reaches is what the PC opens at next.
      case ROUTE.pos: {
        if (!(await inside())) return void json(res, 403, { error: 'outside the folder' })
        if (req.method === 'POST') {
          let body: unknown
          try {
            body = JSON.parse(await readBody(req))
          } catch (err) {
            if (err instanceof TooLarge) return void json(res, 413, { error: 'too large' })
            return void json(res, 400, { error: 'bad request' })
          }
          const patch = memoryPatch(body)
          if (!patch) return void json(res, 400, { error: 'bad memory' })
          this.deps.positions.set(path, patch)
          return void json(res, 200, { ok: true })
        }
        return void json(res, 200, {
          t: null,
          ...((await this.deps.positions.get(path)) ?? {})
        } satisfies PosAnswer)
      }
      case ROUTE.diag: {
        if (req.method !== 'POST') return void json(res, 405, { error: 'POST' })
        let lines: string[]
        try {
          lines = diagLines(JSON.parse(await readBody(req, 32 * 1024)))
        } catch (err) {
          if (err instanceof TooLarge) return void json(res, 413, { error: 'too large' })
          return void json(res, 400, { error: 'bad request' })
        }
        for (const l of lines) this.deps.log?.(`phone "${phone.name}" ${l}`)
        return void json(res, 200, { ok: true, lines: lines.length })
      }
      // The folder the phone is in and everything below it. The folder has to
      // be one this phone listed; every hit's folder is then granted to it,
      // as the Explorer's search grants its hits' folders, so a hit opens.
      case ROUTE.search: {
        const where = q.get('dir') ?? ''
        if (!localPath(where) || !this.deps.access.may(token, where))
          return void json(res, 403, { error: 'outside the folder' })
        const found = await this.deps.search(where, q.get('q') ?? '')
        for (const hit of found.hits) {
          this.deps.access.listed(token, dirname(hit.path))
          if (hit.isFolder) this.deps.access.listed(token, hit.path)
        }
        return void json(res, 200, found)
      }
      // ANY local folder (2026-10-14): what the Explorer can open, the phone
      // can list. Listing it is what grants it, and it is where the phone is.
      case ROUTE.dir: {
        if (!localPath(path) || !(await this.deps.access.local(path)))
          return void json(res, 403, { error: 'not a folder on this PC' })
        const listing = await this.deps.listDir(path)
        if (!listing.unreadable) this.deps.access.listed(token, path)
        this.setHere(phone, path)
        return void json(res, 200, listing)
      }
      // What `file:stat` answers the editor and the Properties popup: size,
      // modified time and folder-ness. Async where the IPC is `statSync`,
      // because the phone path shares main's one thread with a playing film.
      // The grid's pictures (#135): walled like every path, cached by the
      // phone for a day since a key changes with the file, and 404 for a
      // file with no picture in it, which the tile draws as its icon.
      case ROUTE.thumb: {
        if (!(await inside())) return void json(res, 403, { error: 'outside the folder' })
        const jpg = await this.deps.thumb(path)
        if (!jpg) return void json(res, 404, { error: 'no thumbnail' })
        return await this.sendFile(jpg, 'image/jpeg', res, 'private, max-age=86400')
      }
      case ROUTE.stat: {
        if (!(await inside())) return void json(res, 403, { error: 'outside the folder' })
        try {
          const st = await fsp.stat(path)
          return void json(res, 200, {
            size: st.size,
            mtimeMs: st.mtimeMs,
            isFolder: st.isDirectory()
          } satisfies PhoneStat)
        } catch {
          return void json(res, 404, { error: 'no such file' })
        }
      }
      case ROUTE.subs: {
        if (!(await inside())) return void json(res, 403, { error: 'outside the folder' })
        return void json(res, 200, await this.deps.subsFor(path))
      }
      case ROUTE.subsRead: {
        if (!(await inside())) return void json(res, 403, { error: 'outside the folder' })
        const vtt = await this.deps.readSubs(path)
        if (vtt === null) return void json(res, 404, { error: 'no subtitles' })
        res.writeHead(200, {
          'content-type': 'text/vtt; charset=utf-8',
          'cache-control': 'no-store'
        })
        return void res.end(vtt)
      }
      // A text file, read-only: the phone has no route to write one back.
      // A MARKDOWN grants the pictures it names to the phone that read it
      // (they may sit in a folder it never listed, as `docImages.ts` explains), and to
      // main's own wall in the same breath, since `/m/` passes through both.
      case ROUTE.text: {
        if (!(await inside())) return void json(res, 403, { error: 'outside the folder' })
        const r = await this.deps.readText(path)
        if ('text' in r && this.deps.isMarkdown(path)) {
          const imgs = await this.deps.docImages(path, r.text)
          for (const img of imgs) this.grants.grant(token, img)
          if (imgs.length) this.deps.grantServable(imgs)
        }
        return void json(res, 200, r)
      }
      // An office or ebook document as the sanitised HTML the PC's DocView
      // renders; 404 with a reason when main could not convert it.
      case ROUTE.doc: {
        if (!(await inside())) return void json(res, 403, { error: 'outside the folder' })
        const html = await this.deps.docHtml(path)
        if (html === null)
          return void json(res, 404, { error: 'Prism could not convert this document' })
        return void json(res, 200, { html } satisfies DocAnswer)
      }
      // A comic book, read-only: unpacked once under userData by main, and
      // the phone granted the WHOLE directory rather than each page (a book
      // with chapters has pages a folder down, and a 200-page one would be
      // 200 entries to keep in step with an eviction). Main's own wall
      // already allows its comics directory, so nothing is added there.
      // The kind gate is the IPC's (`comicOk`) and so is the failure shape:
      // a phone asking to open a .txt as a comic gets the same `failed`.
      case ROUTE.comic: {
        if (!(await inside())) return void json(res, 403, { error: 'outside the folder' })
        if (!this.deps.isComic(path)) return void json(res, 200, { error: 'failed' })
        const got = await this.deps.comicOpen(path, q.get('pw') ?? '')
        if ('error' in got) return void json(res, 200, got)
        this.grants.grantDir(token, got.dir)
        return void json(res, 200, { pages: got.pages })
      }
      // An archive's listing, and one member extracted for viewing. Read
      // only, by construction: there is no route for the panel's write verbs
      // and the shim has no member for them. The extracted copy is main's
      // own temp file, already in main's `extractedPaths`; the grant here is
      // the one that lets THIS phone fetch it.
      case ROUTE.archive: {
        if (!(await inside())) return void json(res, 403, { error: 'outside the folder' })
        if (!this.deps.isArchive(path)) return void json(res, 200, { ok: false, reason: 'failed' })
        return void json(res, 200, await this.deps.archiveList(path, q.get('pw') || undefined))
      }
      case ROUTE.archiveExtract: {
        if (!(await inside())) return void json(res, 403, { error: 'outside the folder' })
        const entry = q.get('entry')
        if (!entry) return void json(res, 400, { error: 'no entry' })
        if (!this.deps.isArchive(path)) return void json(res, 200, { ok: false, reason: 'failed' })
        const r = await this.deps.archiveExtract(path, entry, q.get('pw') || undefined)
        if (r.ok) this.grants.grant(token, r.path)
        return void json(res, 200, r)
      }
      default:
        return void json(res, 404, { error: 'no such route' })
    }
  }

  /** Bytes through serveMedia: same handler as fsmedia://, same rules. */
  private async serveMedia(path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const headers: Record<string, string> = {}
    if (req.headers.range) headers.range = String(req.headers.range)
    const r = await this.deps.media(
      new Request(`fsmedia://local/${encodeURIComponent(path)}`, { headers })
    )
    const out: Record<string, string> = { 'cache-control': 'no-store' }
    r.headers.forEach((v, k) => {
      if (k.toLowerCase() !== 'access-control-allow-origin') out[k] = v
    })
    // A FILE IS NEVER A PAGE ON THIS ORIGIN (review, 2026-10-14). The phone
    // page lives here and keeps its token in this origin's storage, so an SVG
    // or HTML file on the PC opened by its /m/ address would run its script
    // as the page and could read the whole PC with that token. Sandboxed, a
    // document served here runs nothing and is its own null origin; an
    // <img>, <video> or <audio> embedding it is unaffected.
    out['content-security-policy'] = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"
    out['x-content-type-options'] = 'nosniff'
    res.writeHead(r.status, out)
    if (!r.body) return void res.end()
    const node = Readable.fromWeb(r.body as never)
    node.on('error', () => res.destroy())
    res.on('close', () => node.destroy())
    node.pipe(res)
  }

  /**
   * A job's playlist, init segment or media segment. The job must belong to
   * THIS phone, and a mismatch is 404 rather than 403: another phone is not
   * told the job exists. The playlist is Prism's own text; the two file
   * shapes are waited for (a segment ffmpeg has not reached is produced on
   * the ask, or the run restarted at it) and then streamed. Nothing is
   * cacheable: a restart rewrites every file under the job directory.
   */
  private async hls(
    route: Extract<Route, { kind: 'hls' }>,
    phone: Phone,
    res: ServerResponse
  ): Promise<void> {
    const token = phone.token
    const jobs = this.deps.jobs
    if (!jobs || jobs.owner(route.job) !== token)
      return void json(res, 404, { error: 'no such stream' })
    // The job was walled when it was opened, and a wall can MOVE under it
    // (the phone forgotten and paired again). So a stream is checked against
    // what this phone may read NOW, every time, like every other route, and
    // a stream that fails it is stopped rather than left running.
    const job = jobs.file(route.job)
    if (!job || !this.deps.access.may(token, job)) {
      void jobs.stopFor(token)
      return void json(res, 404, { error: 'no such stream' })
    }
    if (route.file === 'index.m3u8') {
      // The token rides on every uri the playlist names: the player resolves
      // them against the playlist's url and keeps none of its query.
      const text = jobs.playlist(route.job, `?t=${encodeURIComponent(token)}`)
      if (text === null) return void json(res, 404, { error: 'no such stream' })
      res.writeHead(200, { 'content-type': HLS_MIME['.m3u8'], 'cache-control': 'no-store' })
      return void res.end(text)
    }
    const file =
      route.file === 'init.mp4'
        ? await jobs.init(route.job)
        : await jobs.segment(route.job, Number(route.file.split('.')[0]))
    if (file === null) {
      this.deps.log?.(`hls ${route.job}/${route.file} 404 (${jobs.lastError(route.job) ?? 'no such segment'})`)
      return void json(res, 404, { error: jobs.lastError(route.job) ?? 'no such segment' })
    }
    return await this.sendFile(file, HLS_MIME[extname(file)], res)
  }

  /** One whole file, streamed, with its length; 404 if it went away between
   *  the ask and the read (a restart clears the directory). */
  private async sendFile(
    full: string,
    type: string,
    res: ServerResponse,
    cache = 'no-store'
  ): Promise<void> {
    let st: Awaited<ReturnType<typeof fsp.stat>>
    try {
      st = await fsp.stat(full)
    } catch {
      return void json(res, 404, { error: 'not found' })
    }
    res.writeHead(200, {
      'content-type': type,
      'content-length': String(st.size),
      'cache-control': cache
    })
    const s = createReadStream(full)
    s.on('error', () => res.destroy())
    res.on('close', () => s.destroy())
    s.pipe(res)
  }

  /** The phone bundle out of the renderer dir; in dev, out of vite's server. */
  private async serveStatic(
    file: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (this.deps.devUrl) {
      // The QUERY rides along: vite tells a module from a file by it
      // (`?import`, `?v=`, `?t=`), and the parser dropped it for static
      // routes because a file on disk has none. The index is the one path
      // renamed. The HMR websocket is not proxied; a dev edit needs a reload
      // on the phone, which is what a dev proxy is.
      const raw = new URL(req.url ?? '/', this.deps.devUrl)
      const target = new URL((file ? `/${file}` : '/phone.html') + raw.search, this.deps.devUrl)
      const r = await fetch(target, { headers: { accept: String(req.headers.accept ?? '*/*') } })
      res.writeHead(r.status, {
        'content-type': r.headers.get('content-type') ?? 'application/octet-stream'
      })
      if (!r.body) return void res.end()
      Readable.fromWeb(r.body as never).pipe(res)
      return
    }
    const rel = file || 'phone.html'
    const base = normalize(this.deps.rendererDir)
    const full = normalize(join(base, rel))
    // The parser already refused a climb; this is the belt to that brace.
    if (!full.toLowerCase().startsWith(base.toLowerCase()))
      return void json(res, 404, { error: 'not found' })
    let st: Awaited<ReturnType<typeof fsp.stat>>
    try {
      st = await fsp.stat(full)
    } catch {
      return void json(res, 404, { error: 'not found' })
    }
    if (!st.isFile()) return void json(res, 404, { error: 'not found' })
    res.writeHead(200, {
      'content-type': assetMime(full),
      'content-length': String(st.size),
      // Vite hashes its asset names, so those can be cached forever; the page
      // itself is re-validated so a new build shows up on the next open.
      'cache-control': rel.startsWith('assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache'
    })
    const s = createReadStream(full)
    s.on('error', () => res.destroy())
    s.pipe(res)
  }
}
