/**
 * DIRECT OR LIVE, ASKED OF THIS PC (owner, 2026-11-08: "make prism support
 * .mov, i dont think it does"). Chromium decodes H.264, VP8, VP9 and AV1 by
 * itself, everywhere. HEVC it decodes only through the platform: a PC whose
 * GPU and Windows can decode it plays the owner's iPhone films as they are,
 * one that cannot shows sound and a black window. Nothing about that is
 * guessed from the PC: `canPlayType` is asked about THIS film's HEVC (Main
 * and Main 10 are separate answers), and a "no" takes the live transcode
 * (main's liveVideo.ts). A "yes" plays the file itself, with no transcode,
 * and the element still has the last word: a film that then errors, or
 * reaches a frame with no picture, is handed to the same live route once
 * (`rescueLive`). Pure, so the decision is unit-tested; the player supplies
 * `canPlay`.
 */

/** Codecs Chromium decodes only when the platform lends it a decoder. */
const PLATFORM_ONLY = new Set(['hevc'])

/** The `canPlayType` question for an HEVC film of this profile. Level 4.0
 *  (L120) covers 1080p60 and is what Chromium is asked about in practice;
 *  the profile is the part a PC can answer differently. */
export function hevcMime(profile?: string): string {
  const p = (profile ?? '').toLowerCase()
  if (p.includes('main 10')) return 'video/mp4; codecs="hvc1.2.4.L120.90"'
  if (p.includes('rext') || p.includes('range')) return 'video/mp4; codecs="hvc1.4.10.L120.90"'
  return 'video/mp4; codecs="hvc1.1.6.L120.90"'
}

export type PictureRoute = 'direct' | 'live'

/** Why a film took its route, for the log (`film` lines, 2026-11-08). */
export type RouteWhy = 'no-video-stream' | 'forced' | 'converting' | 'hevc-yes' | 'hevc-no' | 'chromium-codec'

export function routeWhy(o: {
  codec?: string
  profile?: string
  forceLive?: boolean
  converting: boolean
  canPlay: (mime: string) => string
}): RouteWhy {
  if (!o.codec) return 'no-video-stream'
  if (o.forceLive) return 'forced'
  if (o.converting) return 'converting'
  if (PLATFORM_ONLY.has(o.codec.toLowerCase())) return o.canPlay(hevcMime(o.profile)) === '' ? 'hevc-no' : 'hevc-yes'
  return 'chromium-codec'
}

/** Does this codec go through the platform's decoder (HEVC only). */
export function isPlatformCodec(codec?: string | null): boolean {
  return !!codec && PLATFORM_ONLY.has(codec.toLowerCase())
}

/** How the picture of a freshly probed film is played. */
export function pictureRoute(o: {
  /** The probe's video codec; absent for audio and for a failed probe. */
  codec?: string
  profile?: string
  /** E2E: take the live route whatever the PC can do. */
  forceLive?: boolean
  /** Main is converting the file once (videoConvert.ts): that route owns it. */
  converting: boolean
  canPlay: (mime: string) => string
}): PictureRoute {
  if (!o.codec) return 'direct'
  if (o.forceLive) return 'live'
  if (o.converting) return 'direct'
  if (PLATFORM_ONLY.has(o.codec.toLowerCase())) return o.canPlay(hevcMime(o.profile)) === '' ? 'live' : 'direct'
  return 'direct'
}

/**
 * The element's last word, after a direct start: does this film go live?
 * Only a film with a picture (`codec`), only once (`tried`), never one that
 * is already live or converted, and only when the element says it failed:
 * an error, or enough data for a frame (readyState 2) and still no width.
 */
/**
 * A FILM NEVER STAYS BLACK (owner, 2026-11-08: "the rest just shows a black
 * screen and wont start"). How long a direct start may go without a picture
 * before it is taken to the live route, whatever the element says or does
 * not say about it: no error, a paused player that was never given a frame,
 * a stalled load. Four seconds is well past a real start (under a second on
 * a local file) and short enough to read as a brief wait.
 */
/** How long a film may be on screen, meant to start, and still not have (#491). */
export const AUTOSTART_MS = 15000

/** Has a film that was meant to start by itself done so? A film YOU paused
 *  stopped being meant to; `wait` is everything still in flight. */
export function autostartCheck(o: {
  paused: boolean
  held: boolean
  elapsedMs: number
}): 'started' | 'held' | 'failed' | 'wait' {
  if (o.held) return 'held'
  if (!o.paused) return 'started'
  return o.elapsedMs >= AUTOSTART_MS ? 'failed' : 'wait'
}

export const NO_PICTURE_MS = 4000

/** The same wait for a film whose first bytes have not even arrived (a disk
 *  spinning up, a network share): a slow source, not a decoder that failed,
 *  and the transcode would read the same slow source. */
export const SLOW_LOAD_MS = 12000

/** What a film's element shows so far. `elapsedMs` counts only time the film
 *  was on screen. */
export function pictureCheck(o: {
  elapsedMs: number
  readyState: number
  videoWidth: number
  /** HTMLMediaElement.networkState; 2 is loading. */
  networkState?: number
  /** A picture already came. A seek drops readyState under 2 for a moment
   *  (measured 2026-11-08: 3% of the time while scrubbing), and that is not
   *  a film without a picture. */
  seen?: boolean
  /** Override of the limit, for a seam only. */
  limitMs?: number
}): 'picture' | 'wait' | 'no-picture' {
  if (o.seen || (o.videoWidth > 0 && o.readyState >= 2)) return 'picture'
  const limit = o.limitMs ?? (o.readyState === 0 && o.networkState === 2 ? SLOW_LOAD_MS : NO_PICTURE_MS)
  return o.elapsedMs >= limit ? 'no-picture' : 'wait'
}

/** How long a playing film must stay black to be called a dead decoder. A
 *  real film can open on black, so this is well past a fade-in; a clip too
 *  short for that is judged on most of its length. */
export const BLACK_MS = 5000

/** Black readings (one every half second) that make the verdict. */
export function blackReadings(duration?: number): number {
  const span = duration && Number.isFinite(duration) ? Math.min(BLACK_MS, duration * 600) : BLACK_MS
  return Math.max(2, Math.ceil(span / 500))
}

/** How a platform decoder's silent failure looks: a film with frames and
 *  sound where every frame is black. `blackReadings` of a PLAYING film in a
 *  row are the verdict; one lit reading settles the film for good. Only
 *  asked of films the platform decodes, and only when playing, so a film
 *  paused on a dark first frame is left alone, and a film that opens on
 *  black has its lit picture before the verdict (movGuard). */
export function blackCheck(o: {
  platform: boolean
  playing: boolean
  t: number
  frames: number
  /** Mean brightness of the frame, or null when it could not be read. */
  lit: number | null
  hits: number
  /** The film's length, when known. */
  duration?: number
}): { hits: number; verdict: 'black' | 'lit' | 'unknown' } {
  if (!o.platform || !o.playing || o.t < 0.6 || o.frames === 0 || o.lit === null) return { hits: o.hits, verdict: 'unknown' }
  if (o.lit > 2) return { hits: 0, verdict: 'lit' }
  const hits = o.hits + 1
  return { hits, verdict: hits >= blackReadings(o.duration) ? 'black' : 'unknown' }
}

export function rescueLive(o: {
  codec?: string | null
  tried: boolean
  converting: boolean
  converted: boolean
  failed: boolean
  readyState: number
  videoWidth: number
}): boolean {
  if (!o.codec || o.tried || o.converting || o.converted) return false
  return o.failed || (o.readyState >= 2 && o.videoWidth === 0)
}

/**
 * MAY THE PLAYER'S ERROR PANEL SPEAK YET (owner, 2026-11-09: "on mov files in
 * the preview it says cannot open this file for a brief second then it plays
 * the video")? The element's error is often not the last word: a film the
 * element refuses is handed to the live route, and the panel flashed for the
 * time that took. So a film that can still be rescued says nothing: before
 * the probe has answered (the error beat it on the owner's PC), and on a
 * direct start with a picture, which `rescueLive` takes to the live route.
 * Nor while a conversion runs: its copy is what the verdict waits on.
 * Once the live route has been tried, a copy has failed, or the file has no
 * picture to rescue, the error is the truth. The phone has no such route.
 */
export function filmErrorShows(o: {
  hasError: boolean
  phone: boolean
  probed: boolean
  hasPicture: boolean
  tried: boolean
  converting: boolean
  converted: boolean
}): boolean {
  if (!o.hasError) return false
  if (o.converting) return false
  if (o.phone || o.tried || o.converted) return true
  return o.probed && !o.hasPicture
}
