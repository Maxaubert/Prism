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
