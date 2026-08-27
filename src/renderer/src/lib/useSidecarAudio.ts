import { useEffect, useRef, useState, type RefObject } from 'react'
import { applyVolume } from './audio'

/**
 * Sound for the tracks Chromium refuses.
 *
 * Dolby Digital (AC-3/E-AC-3), DTS and TrueHD have no decoder in Chromium and
 * never will - a licensing position, not an oversight - so an ordinary MKV rip
 * plays picture-perfect and silent. Prism decodes the track itself in main
 * (fsaudio://, see src/main/audioSidecar.ts) and plays the result in a second,
 * hidden <audio> element beside the video.
 *
 * The video element is the clock. It has no sound of its own to compete with
 * (that being the whole problem), so the audio simply follows it: play, pause,
 * seek and rate are mirrored, and slow drift between the two device clocks is
 * corrected continuously.
 */

export type SidecarState =
  /** Nothing to do: Chromium can play this file's audio. */
  | 'off'
  /** Asking main what the file holds. */
  | 'asking'
  /** Prism is decoding this track, sound is on. */
  | 'on'
  /** The track needs decoding and Prism has no ffmpeg to do it with. */
  | 'unavailable'

// How far the two clocks may drift before we act, in seconds.
const NUDGE_AT = 0.045 // fix by playing very slightly faster/slower
const SEEK_AT = 0.15 // past this, nudging would take too long: jump instead
const NUDGE_RATE = 0.02 // 2% - inaudible on speech, closes 45ms in ~2s
// Starting a stream takes a moment, and the picture does not wait: the first
// alignment always lands a little behind. Re-align once it is really running.
const SETTLE_AT = 0.08
const SETTLE_TRIES = 3

export interface Sidecar {
  state: SidecarState
  /** The video codec, when the file has a picture Prism may not be able to
   *  show. Named in the no-picture note rather than left a mystery. */
  videoCodec: string | null
  /** The fsaudio:// url, once there is one. */
  url: string | null
  /** Attach to the hidden <audio>. */
  ref: RefObject<HTMLAudioElement | null>
}

export function useSidecarAudio(
  path: string,
  video: RefObject<HTMLVideoElement | null>,
  vol: number,
  muted: boolean
): Sidecar {
  const audio = useRef<HTMLAudioElement>(null)
  // Keyed by the file it is about, so a new file is 'asking' by construction
  // and no effect has to clear anything.
  const [ans, setAns] = useState<{
    path: string
    state: SidecarState
    url: string | null
    videoCodec?: string
  } | null>(null)
  const mine = ans?.path === path ? ans : null
  const state: SidecarState = mine ? mine.state : 'asking'
  const url = mine ? mine.url : null
  const videoCodec = mine?.videoCodec ?? null

  // Ask main what this file's audio is. A probe answers in a few milliseconds,
  // so sound starts with the picture rather than after it.
  useEffect(() => {
    let live = true
    void window.prism.probeMedia(path).then((offer) => {
      if (!live) return
      const vc = offer.videoCodec
      if (offer.needed && offer.url) setAns({ path, state: 'on', url: offer.url, videoCodec: vc })
      else if (offer.needed && !offer.ffmpeg) setAns({ path, state: 'unavailable', url: null, videoCodec: vc })
      else setAns({ path, state: 'off', url: null, videoCodec: vc })
    })
    return () => {
      live = false
    }
  }, [path])

  // The second way in. A probe can miss (an exotic container, a track the
  // prober would not name), but the decoder itself cannot lie: video bytes
  // climbing while audio bytes stay at zero means no sound is coming.
  useEffect(() => {
    if (state !== 'off') return
    const el = video.current
    if (!el) return
    let asked = false
    const t = window.setInterval(() => {
      type Counted = HTMLVideoElement & {
        webkitAudioDecodedByteCount?: number
        webkitVideoDecodedByteCount?: number
      }
      const v = el as Counted
      if (asked || el.paused) return
      if ((v.webkitVideoDecodedByteCount ?? 0) < 400_000) return
      if ((v.webkitAudioDecodedByteCount ?? 0) > 0) return
      if (!Number.isFinite(el.duration) || el.duration <= 0) return
      asked = true
      void window.prism.audioBlind(path, el.duration).then((u) => {
        setAns((prev) => ({
          path,
          state: u ? 'on' : 'unavailable',
          url: u,
          videoCodec: prev?.path === path ? prev.videoCodec : undefined
        }))
      })
    }, 1200)
    return () => window.clearInterval(t)
  }, [state, path, video])

  // Volume and mute are the player's, applied here instead of to the video.
  useEffect(() => {
    const a = audio.current
    // applyVolume sets mute as well: past 100% the loudness lives in a gain
    // node, and muting only the element would leave the boost audible.
    if (a) applyVolume(a, vol, muted)
  }, [vol, muted, url])

  // Follow the picture: transport, seeking, speed, and the slow drift between
  // one clock driven by the compositor and one by the sound card.
  useEffect(() => {
    const v = video.current
    const a = audio.current
    if (!url || !v || !a) return

    let settles = 0
    const align = (): void => {
      if (Number.isFinite(v.currentTime)) a.currentTime = v.currentTime
    }
    // The correction after the correction: by the time the decoder has
    // answered and sound is coming out, the picture has moved on by however
    // long that took. One more alignment lands it, and the budget stops this
    // chasing its own tail.
    const settle = (): void => {
      if (v.paused || a.paused || settles >= SETTLE_TRIES) return
      if (Math.abs(a.currentTime - v.currentTime) <= SETTLE_AT) return
      settles++
      align()
    }
    const onPlay = (): void => {
      settles = 0
      align()
      void a.play().catch(() => {})
    }
    const onPause = (): void => a.pause()
    const onRate = (): void => {
      a.playbackRate = v.playbackRate
    }
    const onSeeked = (): void => {
      settles = 0
      align()
      a.playbackRate = v.playbackRate
    }

    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('ratechange', onRate)
    a.addEventListener('playing', settle)
    a.addEventListener('seeked', settle)
    // Mid-file arrival: the picture may already be running.
    a.playbackRate = v.playbackRate
    if (!v.paused) onPlay()

    const drift = window.setInterval(() => {
      if (v.paused || a.paused) return
      const off = a.currentTime - v.currentTime
      if (Math.abs(off) > SEEK_AT) {
        // Too far gone to walk back: a jump costs one restart of the decoder.
        align()
        a.playbackRate = v.playbackRate
      } else if (Math.abs(off) > NUDGE_AT) {
        a.playbackRate = v.playbackRate * (off > 0 ? 1 - NUDGE_RATE : 1 + NUDGE_RATE)
      } else if (a.playbackRate !== v.playbackRate) {
        a.playbackRate = v.playbackRate
      }
    }, 1000)

    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('ratechange', onRate)
      a.removeEventListener('playing', settle)
      a.removeEventListener('seeked', settle)
      window.clearInterval(drift)
      a.pause()
    }
  }, [url, video])

  return { state, url, ref: audio, videoCodec }
}
