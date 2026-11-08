/**
 * A PICTURE THIS PC CANNOT DECODE, PLAYED LIVE (owner, 2026-11-08: "make
 * prism support .mov, i dont think it does"). The owner's iPhone films are
 * HEVC in a .mov, and Chromium shows HEVC only through the platform's own
 * decoder: a PC with the GPU and Windows support for it plays the file as
 * it is, one without has sound and a black window. The renderer finds out
 * which (canPlayType, then the element itself: liveRoute.ts) and, only when
 * the answer is no, asks for THIS: the phone's live HLS transcode (#105,
 * phone/jobs.ts), the same jobs, the same seek-like-a-file playlist written
 * up front, the same GPU-first encoder with the openh264 fallback, played
 * on the desktop by hls.js. Nothing is converted to disk first, so the film
 * starts in about a second and seeks anywhere.
 *
 * WALLED like everything fsmedia:// serves: a job is opened only for a file
 * the asking window may read, it belongs to that window (its token), and
 * every request for a playlist or segment re-checks the file against the
 * wall as it stands NOW. What is served is only what main made itself, in
 * its own folder under userData.
 *
 * GONE WHEN THE PLAYER IS: the renderer stops its job when the file changes
 * or the player unmounts, a window that closes stops all of its own, a quit
 * stops everything, and the folder is wiped at startup.
 */
// The spawn below is phone/jobs.ts's own, wrapped so the film is registered
// with the holders (#127).
// spawn-ok: an HLS job streams segments from ffmpeg, as phone/jobs.ts does.
import { spawn as nodeSpawn } from 'child_process'
import { readFile } from 'fs/promises'
import type { MediaInfo } from './ffmpeg'
import { needsSidecar } from './ffmpeg'
import { ENCODE_MAX_HEIGHT, isHdr, type PlayPlan } from './phone/decide'
import { HlsJobs, type JobDeps } from './phone/jobs'
import type { Held } from './holders'

/** The fsmedia:// host the live streams are served under. */
export const LIVE_HOST = 'live'

export type LivePlan = PlayPlan & { mode: 'hls' }

/** A 4K source keeps its size on the GPU encoder; the software one cannot
 *  keep up with 4K in real time, so it gets the phone's 1080 ceiling. */
const GPU_MAX_HEIGHT = 2160

/**
 * How a film is transcoded for the desktop. The picture is ALWAYS encoded:
 * this route exists only because this PC cannot decode it. The sound is
 * copied when it is AAC, encoded to AAC when Chromium could play it in a
 * file but HLS is stricter (PCM from an iPhone, MP3, Opus), and LEFT OUT
 * when it needs Prism's own decoder: the audio sidecar plays that beside the
 * picture exactly as it does for a direct file, so it is not decoded twice.
 * Null when there is no picture to transcode.
 */
export function livePlan(info: MediaInfo | null, gpu: boolean): { plan: LivePlan; audioIndex: number | null } | null {
  if (!info?.videoCodec || !info.video) return null
  const acodec = info.audio?.codec.toLowerCase() ?? null
  const ceiling = gpu ? GPU_MAX_HEIGHT : ENCODE_MAX_HEIGHT
  const short = Math.min(info.video.width, info.video.height)
  const sidecar = !!info.audio && needsSidecar(info.audio.codec, '.mp4')
  return {
    plan: {
      mode: 'hls',
      copyVideo: false,
      hevcCopy: false,
      copyAudio: acodec === 'aac',
      tonemap: isHdr(info.video.transfer),
      height: short > ceiling ? ceiling : null,
      audioOnly: false,
      ...(info.video.rotation ? { rotation: info.video.rotation } : {})
    },
    audioIndex: info.audio && !sidecar ? info.audio.index : null
  }
}

/** The url a job's playlist is served at. */
export function liveUrl(id: string): string {
  return `fsmedia://${LIVE_HOST}/${id}/index.m3u8`
}

/** `fsmedia://live/<id>/<name>` taken apart; null for anything else. */
export function parseLiveUrl(url: string): { id: string; name: string } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.hostname !== LIVE_HOST) return null
  const m = /^\/([0-9a-f]{16})\/(index\.m3u8|init\.mp4|\d+\.m4s)$/.exec(u.pathname)
  return m ? { id: m[1], name: m[2] } : null
}

/** Is this request one of the live streams, rather than a file. */
export function isLiveRequest(url: string): boolean {
  return url.startsWith(`fsmedia://${LIVE_HOST}/`)
}

/** The token a window's jobs are opened under. */
const tokenOf = (page: number): string => `desktop:${page}`

export interface LiveDeps {
  ffmpeg: string
  baseDir: string
  /** The wall, asked at open AND on every request. */
  readable: (p: string) => boolean
  /** Registers each ffmpeg with the file it reads (holders.ts, #127), so a
   *  move of the film kills the transcode before it renames. */
  hold?: (child: Held, file: string) => void
  /** Resolves once the startup wipe of `baseDir` is done. */
  ready?: Promise<unknown>
  /** Test seam, as in phone/jobs.ts. */
  spawn?: JobDeps['spawn']
  log?: (line: string) => void
}

export interface LiveVideo {
  /** Open (or rejoin) the job for this window and file. */
  open(page: number, file: string, info: MediaInfo | null): Promise<{ url: string; duration: number } | { error: string }>
  /** The window's player let go of this file. */
  stop(page: number, file: string): Promise<void>
  /** The window closed. */
  stopPage(page: number): Promise<void>
  /** Is an ffmpeg running for this window and file (the e2e's question). */
  running(page: number, file: string): boolean
  /** Answer an `fsmedia://live/...` request. Never throws. */
  serve(request: Request): Promise<Response>
  stopAll(): Promise<void>
}

const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }

export function createLiveVideo(deps: LiveDeps): LiveVideo {
  const spawnHeld: JobDeps['spawn'] = ((cmd: string, args: readonly string[], opts: object) => {
    const child = (deps.spawn ?? nodeSpawn)(cmd, args as string[], opts)
    const i = args.indexOf('-i')
    if (deps.hold && i >= 0 && args[i + 1]) deps.hold(child as unknown as Held, args[i + 1])
    return child
  }) as JobDeps['spawn']
  const jobs = new HlsJobs({ ffmpeg: deps.ffmpeg, baseDir: deps.baseDir, spawn: spawnHeld, log: deps.log })
  /** Window -> file (lower case) -> its job and how many players in that
   *  window hold it: the preview and the full view can show the same film,
   *  and the first to let go must not pull the stream from under the other. */
  const byPage = new Map<number, Map<string, { id: string; n: number }>>()
  let reaper: ReturnType<typeof setInterval> | null = null

  const idOf = (page: number, file: string): string | null => byPage.get(page)?.get(file.toLowerCase())?.id ?? null
  /** One holder lets go; the job's id when it was the last. */
  const release = (page: number, file: string): string | null => {
    const files = byPage.get(page)
    const held = files?.get(file.toLowerCase())
    if (!files || !held) return null
    held.n -= 1
    if (held.n > 0) return null
    files.delete(file.toLowerCase())
    if (!files.size) byPage.delete(page)
    return held.id
  }
  const settleReaper = (): void => {
    if (jobs.size && !reaper) {
      // The phone's own rule: ffmpeg of a job nobody has asked about for 30s
      // is killed (a paused film), and the next ask restarts it where it is.
      reaper = setInterval(() => void jobs.reap(), 10_000)
      reaper.unref?.()
    } else if (!jobs.size && reaper) {
      clearInterval(reaper)
      reaper = null
    }
  }

  return {
    async open(page, file, info) {
      if (!deps.readable(file)) return { error: 'outside the folder' }
      const made = livePlan(info, jobs.encoder.video === 'nvenc')
      if (!made || !info || info.duration <= 0) return { error: 'nothing to play' }
      await deps.ready
      const { id } = jobs.open({
        token: tokenOf(page),
        file,
        plan: made.plan,
        duration: info.duration,
        audioIndex: made.audioIndex
      })
      let files = byPage.get(page)
      if (!files) byPage.set(page, (files = new Map()))
      const held = files.get(file.toLowerCase())
      files.set(file.toLowerCase(), { id, n: (held?.n ?? 0) + 1 })
      settleReaper()
      return { url: liveUrl(id), duration: info.duration }
    },
    async stop(page, file) {
      const id = release(page, file)
      if (id) await jobs.stop(id)
      settleReaper()
    },
    async stopPage(page) {
      byPage.delete(page)
      await jobs.stopFor(tokenOf(page))
      settleReaper()
    },
    running(page, file) {
      const id = idOf(page, file)
      return !!id && jobs.running(id)
    },
    async serve(request) {
      try {
        const route = parseLiveUrl(request.url)
        if (!route) return new Response(null, { status: 404, headers: HEADERS })
        const owner = jobs.owner(route.id)
        const file = jobs.file(route.id)
        // A job of the phone's is never served here, and a file the wall no
        // longer lets this app read stops being streamed.
        if (!owner?.startsWith('desktop:') || !file || !deps.readable(file))
          return new Response(null, { status: 403, headers: HEADERS })
        if (route.name === 'index.m3u8') {
          const text = jobs.playlist(route.id)
          if (text === null) return new Response(null, { status: 404, headers: HEADERS })
          return new Response(text, {
            status: 200,
            headers: { ...HEADERS, 'Content-Type': 'application/vnd.apple.mpegurl' }
          })
        }
        const path =
          route.name === 'init.mp4'
            ? await jobs.init(route.id)
            : await jobs.segment(route.id, Number(route.name.split('.')[0]))
        if (!path) return new Response(null, { status: 404, headers: HEADERS })
        const body = await readFile(path)
        return new Response(body, {
          status: 200,
          headers: { ...HEADERS, 'Content-Type': 'video/mp4', 'Content-Length': String(body.length) }
        })
      } catch {
        return new Response(null, { status: 500, headers: HEADERS })
      }
    },
    async stopAll() {
      byPage.clear()
      await jobs.stopAll()
      settleReaper()
    }
  }
}
