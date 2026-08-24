import { useEffect, useRef, useState, type RefObject } from 'react'

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
const SEEK_AT = 0.35 // too far to catch up gracefully: jump
const NUDGE_RATE = 0.02 // 2% - inaudible on speech, closes 45ms in ~2s

export interface Sidecar {
  state: SidecarState
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
  const [ans, setAns] = useState<{ path: string; state: SidecarState; url: string | null } | null>(null)
  const state: SidecarState = ans?.path === path ? ans.state : 'asking'
  const url = ans?.path === path ? ans.url : null

  // Ask main what this file's audio is. A probe answers in a few milliseconds,
  // so sound starts with the picture rather than after it.
  useEffect(() => {
    let live = true
    void window.prism.audioSidecar(path).then((offer) => {
      if (!live) return
      if (offer.needed && offer.url) setAns({ path, state: 'on', url: offer.url })
      else if (offer.needed && !offer.ffmpeg) setAns({ path, state: 'unavailable', url: null })
      else setAns({ path, state: 'off', url: null })
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
        setAns(u ? { path, state: 'on', url: u } : { path, state: 'unavailable', url: null })
      })
    }, 1200)
    return () => window.clearInterval(t)
  }, [state, path, video])

  // Volume and mute are the player's, applied here instead of to the video.
  useEffect(() => {
    const a = audio.current
    if (a) {
      a.volume = vol
      a.muted = muted
    }
  }, [vol, muted, url])

  // Follow the picture: transport, seeking, speed, and the slow drift between
  // one clock driven by the compositor and one by the sound card.
  useEffect(() => {
    const v = video.current
    const a = audio.current
    if (!url || !v || !a) return

    const align = (): void => {
      if (Number.isFinite(v.currentTime)) a.currentTime = v.currentTime
    }
    const onPlay = (): void => {
      align()
      void a.play().catch(() => {})
    }
    const onPause = (): void => a.pause()
    const onRate = (): void => {
      a.playbackRate = v.playbackRate
    }
    const onSeeked = (): void => {
      align()
      a.playbackRate = v.playbackRate
    }

    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('ratechange', onRate)
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
      window.clearInterval(drift)
      a.pause()
    }
  }, [url, video])

  return { state, url, ref: audio }
}
