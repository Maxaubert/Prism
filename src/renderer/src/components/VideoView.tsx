import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useMediaControls } from '../lib/useMediaControls'
import { usePlayerPrefs } from '../lib/playerPrefs'
import { useSubtitles } from '../lib/useSubtitles'
import { useSidecarAudio } from '../lib/useSidecarAudio'
import { Transport } from './Transport'
import { PlayerMenu } from './PlayerMenu'
import { IconFull } from './icons'
import { useWaveform } from '../lib/useWaveform'
import type { TransportStyle } from '../lib/transport'
import { useViz } from '../lib/vizStore'
import { resolveVizTheme } from '../lib/theme'

// The video player: the shared media hook + Transport, on a black stage with a
// video frame, an auto-hiding control overlay, click-to-play,
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
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The chrome never hides while the settings menu is open: an invisible menu
  // would keep eating clicks and the first Escape.
  const menuOpen = useRef(false)

  const showChrome = useCallback(() => {
    setChromeOn(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (video.current && !video.current.paused && !menuOpen.current) setChromeOn(false)
    }, 2600)
  }, [])

  const onMenuOpen = useCallback(
    (open: boolean) => {
      menuOpen.current = open
      showChrome() // opening pins it; closing restarts the hide clock
    },
    [showChrome]
  )

  const c = useMediaControls(video, {
    onFullscreen: onToggleFullscreen,
    onActivity: showChrome,
    onPlayChange: (playing) => {
      if (playing) {
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

  // Click toggles play quietly - no centre icon at all (owner decision,
  // 2026-08-22): the transport says the state, the picture stays clean.
  const clickToggle = (): void => c.togglePlay()

  // Sound for tracks Chromium refuses to decode (Dolby Digital, DTS, TrueHD):
  // main decodes them and this plays the result beside the picture. The video
  // element needs no muting - it has no decoder for that track either, which
  // is the entire problem.
  const { state: sidecarState, url: sidecarUrl, ref: sidecarRef } = useSidecarAudio(path, video, c.vol, c.muted)
  const [hushedUrl, setHushedUrl] = useState<string | null>(null)
  const silent = sidecarState === 'unavailable' && hushedUrl !== url

  return (
    <div
      className="group relative flex h-full w-full items-center justify-center"
      onMouseMove={showChrome}
      onMouseLeave={() => c.playing && !menuOpen.current && setChromeOn(false)}
      style={{ cursor: chromeOn ? 'default' : 'none' }}
    >
      {silent && (
        <div
          role="status"
          className="pointer-events-auto absolute left-1/2 top-3 z-30 flex max-w-[min(560px,86%)] -translate-x-1/2 items-center gap-2 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-side-flat)]/95 px-3.5 py-1.5 text-[12px] text-[var(--p-text-soft)] shadow-[0_10px_28px_rgba(0,0,0,.45)]"
        >
          <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="shrink-0 text-[var(--p-dim)]" aria-hidden>
            <path d="M4 9v6h4l5 4V5L8 9zM17 9l4 6m0-6-4 6" />
          </svg>
          <span className="min-w-0">
            No sound: this file&apos;s audio needs a decoder Prism could not find. The picture is
            unaffected.
          </span>
          <button
            className="ml-1 shrink-0 rounded px-1 text-[var(--p-dim2)] hover:text-[var(--p-text)]"
            onClick={() => setHushedUrl(url)}
            aria-label="Dismiss"
            title="Dismiss"
          >
            <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}
      {sidecarUrl && (
        // Hidden, and deliberately not a child of <video>: it is a second
        // element on its own clock, kept in step by useSidecarAudio.
        <audio ref={sidecarRef} src={sidecarUrl} preload="auto" className="hidden" aria-hidden />
      )}
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
              onOpenChange={onMenuOpen}
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
