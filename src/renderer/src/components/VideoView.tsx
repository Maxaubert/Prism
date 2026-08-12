import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useMediaControls } from '../lib/useMediaControls'
import { usePlayerPrefs } from '../lib/playerPrefs'
import { useSubtitles } from '../lib/useSubtitles'
import { Transport } from './Transport'
import { PlayerMenu } from './PlayerMenu'
import { IconFull, IconPause, IconPlay } from './icons'
import { useWaveform } from '../lib/useWaveform'
import type { TransportStyle } from '../lib/transport'
import { useViz } from '../lib/vizStore'
import { resolveVizTheme } from '../lib/theme'

// The video player: the shared media hook + Transport, on a black stage with a
// video frame, an auto-hiding control overlay, click-to-play with a center flash,
// and fullscreen. Everything transport-related lives in the shared pieces; this
// file only adds the video-specific stage behaviour.

export function VideoView({
  url,
  path,
  onToggleFullscreen,
  onAutoAdvance,
  transportStyle
}: {
  url: string
  /** The file's real path, for finding sidecar subtitles next to it. */
  path: string
  onToggleFullscreen: () => void
  /** Autoplay's exit: the app moves to the next video in the folder. */
  onAutoAdvance: () => void
  transportStyle: TransportStyle
}): JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const prefs = usePlayerPrefs()
  const subtitles = useSubtitles(path)
  const peaks = useWaveform(url, transportStyle === 'wave' || transportStyle === 'wavebold')
  const solidBg = transportStyle !== 'edge' && transportStyle !== 'outline' && transportStyle !== 'island'
  const v = useViz()
  const barFx = { palette: resolveVizTheme(v.barTheme).palette, glow: v.barGlow, cycle: v.barCycle, move: v.barMove }
  const [chromeOn, setChromeOn] = useState(true)
  const [flash, setFlash] = useState<'play' | 'pause' | null>(null)
  // Whether playback has ever begun. Videos autoplay, so the resting play icon
  // should only appear once the user pauses a started video — never during the
  // brief pre-autoplay moment (which otherwise flashes on every navigation).
  const [started, setStarted] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showChrome = useCallback(() => {
    setChromeOn(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (video.current && !video.current.paused) setChromeOn(false)
    }, 2600)
  }, [])

  const c = useMediaControls(video, {
    onFullscreen: onToggleFullscreen,
    onActivity: showChrome,
    onPlayChange: (playing) => {
      if (playing) {
        setStarted(true)
        showChrome()
      } else {
        setChromeOn(true)
      }
    },
    errorMsg: 'This video can’t be played (unsupported codec or corrupt file).',
    resumeKey: url
  })

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  // Click toggles play with a brief center flash; keyboard toggles quietly.
  const clickToggle = (): void => {
    setFlash(c.playing ? 'pause' : 'play')
    setTimeout(() => setFlash(null), 450)
    c.togglePlay()
  }

  return (
    <div
      className="group relative flex h-full w-full items-center justify-center"
      onMouseMove={showChrome}
      onMouseLeave={() => c.playing && setChromeOn(false)}
      style={{ cursor: chromeOn ? 'default' : 'none' }}
    >
      <video
        ref={video}
        src={url}
        autoPlay
        loop={prefs.loop}
        // Autoplay: the folder is a playlist. Loop wins while both are on
        // (a looping video never ends, so this simply doesn't fire).
        onEnded={() => prefs.autoplay && onAutoAdvance()}
        // Fill the stage and letterbox only on the axis that needs it. max-w/max-h
        // would cap the video at its intrinsic size, so anything smaller than the
        // window (e.g. a 720p file fullscreened) sat boxed in on all four sides.
        className="h-full w-full object-contain"
        onClick={clickToggle}
        onDoubleClick={onToggleFullscreen}
        {...c.bind}
      >
        {/* Keyed by URL so switching tracks replaces the element: Chromium is
            happier remounting a track than watching its src change. */}
        {subtitles.vttUrl && (
          <track key={subtitles.vttUrl} default kind="subtitles" src={subtitles.vttUrl} label="Subtitles" />
        )}
      </video>

      {/* center play/pause flash + the resting play affordance, but only once a
          video has started (so autoplay startup + navigation don't flash it) */}
      {(flash || (started && !c.playing && !c.error)) && (
        <div className="pointer-events-none absolute grid place-items-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-[var(--p-title)]/85 text-[var(--p-text)] backdrop-blur-sm">
            <div className="scale-[1.6]">{c.playing ? IconPause : IconPlay}</div>
          </div>
        </div>
      )}

      {c.error && (
        <div className="absolute inset-0 grid place-items-center bg-[var(--p-bg)]/90 p-8 text-center text-sm text-[var(--p-text-soft)]">
          {c.error}
        </div>
      )}

      {/* auto-hiding control overlay */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 transition-opacity duration-200 ${
          solidBg ? 'bg-[var(--p-title)]' : ''
        } ${chromeOn ? 'opacity-100' : 'opacity-0'}`}
      >
        <Transport
          c={c}
          style={transportStyle}
          peaks={peaks}
          bar={barFx}
          settings={
            <PlayerMenu
              c={c}
              autoplayHint="video"
              subtitles={{ tracks: subtitles.tracks, active: subtitles.active, onPick: subtitles.pick }}
            />
          }
          extra={
            <button
              className="grid place-items-center hover:text-[var(--color-accent-hi)]"
              onClick={onToggleFullscreen}
              title="Fullscreen (F)"
            >
              {IconFull}
            </button>
          }
        />
      </div>
    </div>
  )
}
