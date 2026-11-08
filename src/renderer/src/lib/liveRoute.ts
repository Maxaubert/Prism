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
export const NO_PICTURE_MS = 4000

/** What a film's element shows so far. */
export function pictureCheck(o: {
  elapsedMs: number
  readyState: number
  videoWidth: number
  /** Override of the limit, for a seam only. */
  limitMs?: number
}): 'picture' | 'wait' | 'no-picture' {
  if (o.videoWidth > 0 && o.readyState >= 2) return 'picture'
  return o.elapsedMs >= (o.limitMs ?? NO_PICTURE_MS) ? 'no-picture' : 'wait'
}

/** How a platform decoder's silent failure looks: a film with frames and
 *  sound where every frame is black. Two black readings of a PLAYING film in
 *  a row are the verdict; one lit reading settles the film for good. Only
 *  asked of films the platform decodes, and only when playing, so a film
 *  paused on a dark first frame or one that opens on black is left alone. */
export function blackCheck(o: {
  platform: boolean
  playing: boolean
  t: number
  frames: number
  /** Mean brightness of the frame, or null when it could not be read. */
  lit: number | null
  hits: number
}): { hits: number; verdict: 'black' | 'lit' | 'unknown' } {
  if (!o.platform || !o.playing || o.t < 0.6 || o.frames === 0 || o.lit === null) return { hits: o.hits, verdict: 'unknown' }
  if (o.lit > 2) return { hits: 0, verdict: 'lit' }
  const hits = o.hits + 1
  return { hits, verdict: hits >= 2 ? 'black' : 'unknown' }
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
