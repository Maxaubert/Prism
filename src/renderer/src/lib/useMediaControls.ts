import { useCallback, useEffect, useRef, useState, type RefObject, type SyntheticEvent } from 'react'
import { rememberPaused, rememberTime, sessionTime } from './playState'
import { applyVolume, idleAudioContext, wakeAudioContext } from './audio'
import { setTabVolume, tabVolume } from './tabVolume'

// The shared brain of both players. Owns playback state, exposes controls, and
// binds the media element's events + the keyboard. Video and audio use the same
// hook so their behaviour (and the Transport bar on top of it) is identical; a
// player is then just this hook + a Transport + its own stage (frame / visualiser).

export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

// Resume-position: long media reopens where you left off; short clips (music
// videos, songs) always restart so you hear them whole. Position is saved per
// file url and cleared once you reach the end.
const RESUME_PREFIX = 'prism.resume.'
const RESUME_MIN_DURATION = 600 // seconds (10 minutes)
const RESUME_END_PAD = 5 // don't resume/save within this many seconds of the end
const RESUME_SAVE_STEP = 5 // save at most once per this many seconds of movement
const SESSION_END_PAD = 0.5 // a file that ran to its end restarts, however short it is

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
  /** Volume or mute just changed, by any route - the wheel, the keys, the
   *  slider. The video's on-screen volume readout listens for this rather than
   *  watching the value, so nothing has to set state inside an effect. */
  onVolume?: () => void
  errorMsg?: string
  /** Whose volume this is: the tab, for this session (see lib/tabVolume). The
   *  same level follows you across the files you open in that tab, and a new
   *  tab starts at 100%. Omit and the player simply starts at 100%. */
  volumeKey?: string
  /** False for a player that is mounted but not on screen (another tab is in
   *  front): it keeps playing, but the keyboard belongs to what you can see. */
  keys?: boolean
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
  const {
    onFullscreen,
    onPlayChange,
    onActivity,
    onVolume,
    errorMsg,
    resumeKey,
    keys = true,
    volumeKey = ''
  } = opts
  // Resume-position bookkeeping. This hook is remounted per file (the viewer is
  // keyed by path), so these refs start fresh for each media element.
  const resumedRef = useRef(false)
  const lastSavedRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [vol, setVolState] = useState(() => clampVol(tabVolume(volumeKey).vol))
  const [muted, setMuted] = useState(() => tabVolume(volumeKey).muted)
  const [rate, setRate] = useState(1)
  const [error, setError] = useState<string | null>(null)

  // Mirror volume/mute/rate onto the element; remember volume across sessions.
  // Past 100% the element cannot help - its volume stops at 1 - so applyVolume
  // hands the rest to a gain node.
  useEffect(() => {
    const m = ref.current
    if (m) applyVolume(m, vol, muted)
    // Handed to the tab, not to disk: it survives moving between files in this
    // tab and dies with the session.
    setTabVolume(volumeKey, { vol, muted })
  }, [vol, muted, ref, volumeKey])
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate
  }, [rate, ref])

  /**
   * A NEW FILE is a new file (2026-08-28).
   *
   * The viewer is keyed by KIND, not by path, so arrowing through a folder
   * never remounts this hook - which meant three things quietly outlived the
   * file they belonged to: `resumedRef` stayed true, so only the FIRST long
   * video in a tab ever resumed; `error` stayed set, so one unplayable file
   * left its overlay across every file after it; and the element's own
   * playbackRate went back to 1 with the new src while `rate` still said 1.5,
   * so the cog read 1.50x over a film playing at normal speed.
   *
   * Done while RENDERING rather than in an effect: by the time an effect runs
   * the new file has already had a frame with the old file's error on top of
   * it. The element half is an effect, because it is a DOM write.
   */
  const [fileKey, setFileKey] = useState(resumeKey)
  if (fileKey !== resumeKey) {
    setFileKey(resumeKey)
    setError(null)
    setCur(0)
    setBuffered(0)
  }
  useEffect(() => {
    // The bookkeeping refs are the other half of the same reset. Refs cannot
    // be touched while rendering, so they are settled here - before the new
    // element has loaded anything, which is what they are read against.
    resumedRef.current = false
    lastSavedRef.current = 0
    const m = ref.current
    if (!m) return
    // The speed you chose is a preference about watching, not about one file,
    // so it is re-applied rather than reset - the element itself came back at
    // 1x with the new src.
    m.playbackRate = rate
    m.defaultPlaybackRate = rate
    applyVolume(m, vol, muted)
    // Deliberately only on a change of FILE: rate/vol/muted have their own
    // effects, and this one re-applies whatever they are at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeKey, ref])

  const setVol = useCallback(
    (v: number) => {
      setVolState(clampVol(v))
      onVolume?.()
    },
    [onVolume]
  )
  const bumpVol = useCallback(
    (d: number) => {
      setVolState((x) => +clampVol(x + d).toFixed(2))
      onVolume?.()
    },
    [onVolume]
  )
  const toggleMute = useCallback(() => {
    setMuted((x) => !x)
    onVolume?.()
  }, [onVolume])
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
    if (!keys) return
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
  }, [togglePlay, seekBy, bumpVol, toggleMute, stepRate, seekTo, onFullscreen, onActivity, ref, keys])

  const bind: MediaBindings = {
    onPlay: () => {
      // A boosted element plays THROUGH the shared context, so it has to be
      // awake before the sound can arrive (2026-08-28).
      wakeAudioContext()
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
      // Nothing left playing anywhere in the window: let the audio thread and
      // its device clock go. Any route back in wakes it first.
      if (![...document.querySelectorAll('video,audio')].some((m) => !(m as HTMLMediaElement).paused))
        idleAudioContext()
      if (resumeKey) rememberPaused(resumeKey, true)
      onPlayChange?.(false)
    },
    onTimeUpdate: (e) => {
      const m = e.currentTarget
      setCur(m.currentTime)
      // Persist position for long media, throttled; clear it near the end so the
      // file restarts next time instead of resuming at ~100%.
      if (resumeKey) rememberTime(resumeKey, m.currentTime)
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
      // Once we know the duration, seek back to where this file was (once).
      // Two sources, and the session one wins: it is exact, it covers files of
      // any length, and it is what "I only switched tabs for a second" means.
      // The stored position is the older, cross-session rule, films only.
      if (!resumedRef.current && resumeKey && Number.isFinite(m.duration)) {
        resumedRef.current = true
        const here = sessionTime(resumeKey)
        const stored =
          m.duration > RESUME_MIN_DURATION ? Number(localStorage.getItem(RESUME_PREFIX + resumeKey)) : 0
        const at = here > 0 ? here : stored
        const limit = here > 0 ? m.duration - SESSION_END_PAD : m.duration - RESUME_END_PAD
        if (at > 0 && at < limit) {
          m.currentTime = at
          setCur(at)
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
