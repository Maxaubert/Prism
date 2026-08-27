import { useCallback, useEffect, useRef, useState, type RefObject, type SyntheticEvent } from 'react'
import { rememberPaused } from './playState'
import { applyVolume } from './audio'

// The shared brain of both players. Owns playback state, exposes controls, and
// binds the media element's events + the keyboard. Video and audio use the same
// hook so their behaviour (and the Transport bar on top of it) is identical; a
// player is then just this hook + a Transport + its own stage (frame / visualiser).

export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const VOL_KEY = 'prism.volume'

// Resume-position: long media reopens where you left off; short clips (music
// videos, songs) always restart so you hear them whole. Position is saved per
// file url and cleared once you reach the end.
const RESUME_PREFIX = 'prism.resume.'
const RESUME_MIN_DURATION = 600 // seconds (10 minutes)
const RESUME_END_PAD = 5 // don't resume/save within this many seconds of the end
const RESUME_SAVE_STEP = 5 // save at most once per this many seconds of movement

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
  /** Stable per-file key (the media url). Enables resume-position for media
   *  longer than RESUME_MIN_DURATION - which is why a 5-second clip is never
   *  remembered, and a film is. Both players pass it. Omit to disable. */
  resumeKey?: string
}

/** Volume runs to 200%, as VLC's does; past 100% it is a gain (see lib/audio).
 *  VLC's own default ceiling is 125%, but its slider goes to 200 and so does
 *  this one - the point of the feature is the quiet film. */
export const MAX_VOL = 2
const clampVol = (v: number): number => Math.max(0, Math.min(MAX_VOL, v))

export function useMediaControls(ref: RefObject<HTMLMediaElement | null>, opts: Options = {}): MediaControls {
  const { onFullscreen, onPlayChange, onActivity, errorMsg, resumeKey } = opts
  // Resume-position bookkeeping. This hook is remounted per file (the viewer is
  // keyed by path), so these refs start fresh for each media element.
  const resumedRef = useRef(false)
  const lastSavedRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [vol, setVolState] = useState(() => {
    const v = Number(localStorage.getItem(VOL_KEY))
    return Number.isFinite(v) && v > 0 ? clampVol(v) : 1
  })
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [error, setError] = useState<string | null>(null)

  // Mirror volume/mute/rate onto the element; remember volume across sessions.
  // Past 100% the element cannot help - its volume stops at 1 - so applyVolume
  // hands the rest to a gain node.
  useEffect(() => {
    const m = ref.current
    if (m) applyVolume(m, vol, muted)
    localStorage.setItem(VOL_KEY, String(vol))
  }, [vol, muted, ref])
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate
  }, [rate, ref])

  const setVol = useCallback((v: number) => setVolState(clampVol(v)), [])
  const bumpVol = useCallback((d: number) => setVolState((x) => +clampVol(x + d).toFixed(2)), [])
  const toggleMute = useCallback(() => setMuted((x) => !x), [])
  const stepRate = useCallback(
    (dir: number) =>
      setRate((r) => {
        // From the NEAREST preset: the menu's slider sets rates between the
        // presets, and stepping from those must not snap to an end of the list.
        const nearest = RATES.reduce((a, b, i) => (Math.abs(b - r) < Math.abs(RATES[a] - r) ? i : a), 0)
        return RATES[Math.max(0, Math.min(RATES.length - 1, nearest + dir))] ?? r
      }),
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

  // Keyboard transport. The app-level handler (capture phase) owns ←/→ while the
  // user is paging through a folder and calls preventDefault; here we honour that
  // by yielding any key it already claimed. Otherwise the player owns ←/→ (seek)
  // and the rest of the standard media shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Never swallow keys meant for a text field: space would toggle playback
      // instead of typing a space, and the letter shortcuts would fire too.
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.defaultPrevented) return // the app claimed this key (folder paging)
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
      // Remembered for the session, so opening Settings (or any other tab) and
      // coming back does not restart a film you had deliberately paused: a tab
      // renders only while it is in front, so the player comes back as a fresh
      // element that would autoplay.
      if (resumeKey) rememberPaused(resumeKey, false)
      onPlayChange?.(true)
    },
    onPause: () => {
      setPlaying(false)
      if (resumeKey) rememberPaused(resumeKey, true)
      onPlayChange?.(false)
    },
    onTimeUpdate: (e) => {
      const m = e.currentTarget
      setCur(m.currentTime)
      // Persist position for long media, throttled; clear it near the end so the
      // file restarts next time instead of resuming at ~100%.
      if (resumeKey && Number.isFinite(m.duration) && m.duration > RESUME_MIN_DURATION) {
        if (m.currentTime > m.duration - RESUME_END_PAD) {
          localStorage.removeItem(RESUME_PREFIX + resumeKey)
        } else if (Math.abs(m.currentTime - lastSavedRef.current) >= RESUME_SAVE_STEP) {
          lastSavedRef.current = m.currentTime
          localStorage.setItem(RESUME_PREFIX + resumeKey, String(Math.floor(m.currentTime)))
        }
      }
    },
    onDurationChange: (e) => {
      const m = e.currentTarget
      setDur(m.duration)
      // Once we know the duration, seek a long file to its saved position (once).
      if (!resumedRef.current && resumeKey && Number.isFinite(m.duration) && m.duration > RESUME_MIN_DURATION) {
        resumedRef.current = true
        const saved = Number(localStorage.getItem(RESUME_PREFIX + resumeKey))
        if (saved > 0 && saved < m.duration - RESUME_END_PAD) {
          m.currentTime = saved
          setCur(saved)
        }
      }
    },
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
