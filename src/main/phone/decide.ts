/**
 * Direct or HLS, per file and per DEVICE (2026-09-06, #105). The phone says
 * what it plays (canPlayType, reported as tokens) and the decision is a
 * plain lookup: a container the phone cannot demux is HLS whatever the
 * codecs; a codec the phone plays is COPIED into the segments and a codec
 * it does not is encoded. Nothing is assumed from a user agent.
 *
 * Pure: the file's probe, its extension and the phone's tokens go in, a plan
 * comes out. What runs ffmpeg lives beside this, not in it.
 */
import type { MediaInfo } from '../ffmpeg'

/** What the phone said it plays: codec and container tokens, lower case. */
export type Can = ReadonlySet<string>

export type PlayPlan =
  | { mode: 'direct' }
  | {
      mode: 'hls'
      /** The phone plays the picture's codec: copy it into the segments. */
      copyVideo: boolean
      /** The sound is something every HLS player takes: copy it too. */
      copyAudio: boolean
      /** The picture is HDR and is being encoded: tone-map it on the way. */
      tonemap: boolean
      /** Scale an encode down to this height; null keeps the source size. */
      height: number | null
      /** No picture at all: an audio playlist. */
      audioOnly: boolean
    }
  | { mode: 'none'; reason: string }

/** Encode ceiling. A 4K encode is four times the pixels for a phone screen. */
export const ENCODE_MAX_HEIGHT = 1080

/** Containers a phone's <video>/<audio> can open by itself, by the token the
 *  phone reports for them. */
const DIRECT_CONTAINERS: Record<string, string> = {
  '.mp4': 'mp4',
  '.m4v': 'mp4',
  '.mov': 'mp4',
  '.m4a': 'mp4',
  '.aac': 'mp4',
  '.webm': 'webm',
  '.mp3': 'mp3',
  '.flac': 'flac',
  '.wav': 'wav',
  '.ogg': 'ogg',
  '.oga': 'ogg',
  '.opus': 'ogg'
}

/** Containers whose token is also the codec's: an mp3 file IS its codec, and
 *  a wav's pcm_s16le is never a token a phone reports, so the container
 *  answers for the sound. */
const SELF_CONTAINED = new Set(['mp3', 'flac', 'wav'])

/** Audio codecs that may be COPIED into fMP4 segments. AAC is the one every
 *  HLS player takes; Dolby goes in only where the phone said it plays it.
 *  Anything else is re-encoded even when the phone would play it in a file,
 *  because HLS is stricter than a file. */
const HLS_COPY_AUDIO = new Set(['aac', 'ac3', 'eac3'])

/** HDR transfers: PQ (HDR10, Dolby Vision profiles on PQ) and HLG. */
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])

export function parseCan(csv: string | null | undefined): Can {
  return new Set(
    (csv ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
}

export function isHdr(transfer: string): boolean {
  return HDR_TRANSFERS.has(transfer)
}

export function decide(info: MediaInfo | null, ext: string, can: Can): PlayPlan {
  if (!info) return { mode: 'none', reason: 'Prism could not read this file' }
  const container = DIRECT_CONTAINERS[ext.toLowerCase()] ?? null
  const vcodec = info.videoCodec?.toLowerCase() ?? null
  const acodec = info.audio?.codec.toLowerCase() ?? null

  // Direct only when the container AND every stream's codec are things the
  // phone reported. The container goes first: an mkv of h264 + aac is one
  // no phone's <video> can open, however ordinary its codecs.
  const containerOk = container !== null && can.has(container)
  const videoOk = vcodec === null || can.has(vcodec)
  const audioOk =
    acodec === null || can.has(acodec) || (container !== null && SELF_CONTAINED.has(container) && can.has(container))
  if (containerOk && videoOk && audioOk) return { mode: 'direct' }

  const audioOnly = vcodec === null
  const copyVideo = !audioOnly && can.has(vcodec)
  const encodeVideo = !audioOnly && !copyVideo
  const hdr = info.video !== null && isHdr(info.video.transfer)
  const height = encodeVideo && info.video !== null && info.video.height > ENCODE_MAX_HEIGHT ? ENCODE_MAX_HEIGHT : null
  return {
    mode: 'hls',
    copyVideo,
    copyAudio: acodec === 'aac' || (acodec !== null && HLS_COPY_AUDIO.has(acodec) && can.has(acodec)),
    tonemap: encodeVideo && hdr,
    height,
    audioOnly
  }
}
