import { useCallback, useEffect, useState, type RefObject, type SyntheticEvent } from 'react'

// The shared brain of both players. Owns playback state, exposes controls, and
// binds the media element's events + the keyboard. Video and audio use the same
// hook so their behaviour (and the Transport bar on top of it) is identical; a
// player is then just this hook + a Transport + its own stage (frame / visualiser).

export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const VOL_KEY = 'prism.volume'

export interface MediaBindings {
  onPlay: () => void
  onPause: () => void
  onTimeUpdate: (e: SyntheticEvent<HTMLMediaElement>) => void
  onDurationChange: (e: SyntheticEvent<HTMLMediaElement>) => void
  onProgress: (e: SyntheticEvent<HTMLMediaElement>) => void
  onError: () => void
}

export interface MediaControls {
  playing: boolean
  cur: number
  dur: number
  buffered: number
  vol: number
  muted: boolean
  rate: number
  error: string | null
  setVol: (v: number) => void
  toggleMute: () => void
  setRate: (r: number) => void
  stepRate: (dir: number) => void
  togglePlay: () => void
  seekTo: (t: number) => void
  seekBy: (d: number) => void
  bumpVol: (d: number) => void
  /** Spread onto the <video>/<audio> element. */
  bind: MediaBindings
}

interface Options {
  /** 'f' key + the fullscreen button; omit for players with no fullscreen. */
  onFullscreen?: () => void
  /** Called on play/pause so a view can react (e.g. video auto-hides its chrome). */
  onPlayChange?: (playing: boolean) => void
  /** Called on any keyboard transport action (e.g. to re-show video chrome). */
  onActivity?: () => void
  errorMsg?: string
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

export function useMediaControls(ref: RefObject<HTMLMediaElement | null>, opts: Options = {}): MediaControls {
  const { onFullscreen, onPlayChange, onActivity, errorMsg } = opts
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [vol, setVolState] = useState(() => {
    const v = Number(localStorage.getItem(VOL_KEY))
    return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 1
  })
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [error, setError] = useState<string | null>(null)

  // Mirror volume/mute/rate onto the element; remember volume across sessions.
  useEffect(() => {
    const m = ref.current
    if (m) {
      m.volume = vol
      m.muted = muted
    }
    localStorage.setItem(VOL_KEY, String(vol))
  }, [vol, muted, ref])
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate
  }, [rate, ref])

  const setVol = useCallback((v: number) => setVolState(clamp01(v)), [])
  const bumpVol = useCallback((d: number) => setVolState((x) => +clamp01(x + d).toFixed(2)), [])
  const toggleMute = useCallback(() => setMuted((x) => !x), [])
  const stepRate = useCallback(
    (dir: number) => setRate((r) => RATES[Math.max(0, Math.min(RATES.length - 1, RATES.indexOf(r) + dir))] ?? r),
    []
  )

  const togglePlay = useCallback(() => {
    const m = ref.current
    if (!m) return
    if (m.paused) void m.play()
    else m.pause()
  }, [ref])
  const seekTo = useCallback(
    (t: number) => {
      const m = ref.current
      if (!m || !Number.isFinite(m.duration)) return
      m.currentTime = Math.max(0, Math.min(m.duration, t))
      setCur(m.currentTime)
    },
    [ref]
  )
  const seekBy = useCallback((d: number) => seekTo((ref.current?.currentTime ?? 0) + d), [seekTo, ref])

  // Keyboard transport. The app-level handler skips arrows for playable media, so
  // the player owns ←/→ (seek) and the rest of the standard media shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Never swallow keys meant for a text field: space would toggle playback
      // instead of typing a space, and the letter shortcuts would fire too.
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      const act = (): void => onActivity?.()
      switch (e.key) {
        case ' ':
        case 'k': e.preventDefault(); togglePlay(); act(); break
        case 'ArrowRight': seekBy(5); act(); break
        case 'ArrowLeft': seekBy(-5); act(); break
        case 'l': seekBy(10); act(); break
        case 'j': seekBy(-10); act(); break
        case 'ArrowUp': e.preventDefault(); bumpVol(0.05); act(); break
        case 'ArrowDown': e.preventDefault(); bumpVol(-0.05); act(); break
        case 'm': toggleMute(); act(); break
        case 'f': onFullscreen?.(); break
        case '.': seekBy(1 / 30); break
        case ',': seekBy(-1 / 30); break
        case '>': stepRate(1); break
        case '<': stepRate(-1); break
        case 'Home': seekTo(0); break
        case 'End': seekTo(ref.current?.duration ?? 0); break
        default:
          if (/^[0-9]$/.test(e.key)) seekTo((Number(e.key) / 10) * (ref.current?.duration ?? 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seekBy, bumpVol, toggleMute, stepRate, seekTo, onFullscreen, onActivity, ref])

  const bind: MediaBindings = {
    onPlay: () => {
      setPlaying(true)
      onPlayChange?.(true)
    },
    onPause: () => {
      setPlaying(false)
      onPlayChange?.(false)
    },
    onTimeUpdate: (e) => setCur(e.currentTarget.currentTime),
    onDurationChange: (e) => setDur(e.currentTarget.duration),
    onProgress: (e) => {
      const m = e.currentTarget
      if (m.buffered.length) setBuffered(m.buffered.end(m.buffered.length - 1))
    },
    onError: () => setError(errorMsg ?? 'This file can’t be played.')
  }

  return {
    playing, cur, dur, buffered, vol, muted, rate, error,
    setVol, toggleMute, setRate, stepRate, togglePlay, seekTo, seekBy, bumpVol, bind
  }
}
