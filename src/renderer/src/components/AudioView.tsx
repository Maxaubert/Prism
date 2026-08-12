import { useCallback, useEffect, useRef, useState, type JSX, type SyntheticEvent } from 'react'
import { useMediaControls } from '../lib/useMediaControls'
import { usePlayerPrefs } from '../lib/playerPrefs'
import { Transport } from './Transport'
import { PlayerMenu } from './PlayerMenu'
import { Visualizer } from './Visualizer'
import { useWaveform } from '../lib/useWaveform'
import type { TransportStyle } from '../lib/transport'
import { resolveVizTheme } from '../lib/theme'
import { useViz, WIDTHS } from '../lib/vizStore'

// The audio player: the chosen visualizer fills the window. Style, colour, and
// framing all come from the shared vizStore (set in the app Settings window). The
// filename stays in the title bar rather than on the glass. The <audio> element is
// hidden and crossorigin so the visualizer's AnalyserNode can read its samples.

function Logo(): JSX.Element {
  return (
    <div className="grid h-28 w-28 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-[#5b5bd6] via-[#9a6cff] to-[#ff9a8b] text-5xl text-[var(--p-text)] shadow-[0_12px_40px_rgba(120,90,255,0.35)]">
      ♪
    </div>
  )
}

// Some MP3s report duration Infinity until a seek forces Chromium to compute it,
// which leaves the scrubber stuck; nudge to the end and back once on load.
function forceDuration(e: SyntheticEvent<HTMLMediaElement>): void {
  const m = e.currentTarget
  if (m.duration === Infinity || Number.isNaN(m.duration)) {
    const onT = (): void => {
      m.removeEventListener('timeupdate', onT)
      m.currentTime = 0
    }
    m.addEventListener('timeupdate', onT)
    try {
      m.currentTime = 1e101
    } catch {
      /* seek not ready yet; ignore */
    }
  }
}

export function AudioView({
  url,
  name,
  fullscreen,
  onToggleFullscreen,
  onAutoAdvance,
  transportStyle
}: {
  url: string
  name: string
  fullscreen: boolean
  onToggleFullscreen: () => void
  /** Autoplay's exit: the app moves to the next track in the folder. */
  onAutoAdvance: () => void
  transportStyle: TransportStyle
}): JSX.Element {
  const v = useViz()
  const prefs = usePlayerPrefs()
  const peaks = useWaveform(url, transportStyle === 'wave' || transportStyle === 'wavebold')
  const transportBg = transportStyle !== 'edge' && transportStyle !== 'outline' && transportStyle !== 'island'
  const barFx = { palette: resolveVizTheme(v.barTheme).palette, glow: v.barGlow, cycle: v.barCycle, move: v.barMove }
  // A callback ref feeds both the controls hook (via the ref object) and the
  // visualizer (via state, so it re-renders once the element actually mounts).
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [mediaEl, setMediaEl] = useState<HTMLAudioElement | null>(null)
  const setMedia = (el: HTMLAudioElement | null): void => {
    audioRef.current = el
    setMediaEl(el)
  }

  // In fullscreen the transport auto-hides like a video player: it slides away
  // after a moment of no mouse movement and returns on the next move. Windowed, it
  // stays put.
  const [chromeOn, setChromeOn] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showChrome = useCallback(() => {
    setChromeOn(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (fullscreen) hideTimer.current = setTimeout(() => setChromeOn(false), 2600)
  }, [fullscreen])

  const c = useMediaControls(audioRef, {
    onFullscreen: onToggleFullscreen,
    onActivity: showChrome,
    errorMsg: `“${name}” can’t be played (unsupported codec or corrupt file).`,
    resumeKey: url
  })

  // Entering fullscreen arms the auto-hide; leaving it clears the timer. Chrome is
  // always shown windowed (see chromeVisible), so the effect never setStates there.
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (fullscreen) {
      hideTimer.current = setTimeout(() => setChromeOn(false), 2600)
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [fullscreen])
  const chromeVisible = !fullscreen || chromeOn

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      onMouseMove={showChrome}
      style={{ cursor: chromeVisible ? undefined : 'none' }}
    >
      <audio
        ref={setMedia}
        src={url}
        crossOrigin="anonymous"
        autoPlay
        loop={prefs.loop}
        onEnded={() => prefs.autoplay && onAutoAdvance()}
        className="hidden"
        onLoadedMetadata={forceDuration}
        {...c.bind}
      />

      {c.error ? (
        <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-[#c9ccd6]">
          {c.error}
        </div>
      ) : (
        <>
          {/* The visualizer fills the whole viewer, the same box the nav arrows
              centre in, so vertical position 50 lands exactly on the nav-button
              line at any window size. Height and position size and place the
              canvas itself, so no style code has to know about them. The
              transport (below) overlays the bottom edge. */}
          <div
            className="absolute left-1/2"
            style={{
              width: '100%',
              height: `${v.height}%`,
              top: `${v.pos}%`,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div className={`mx-auto h-full ${WIDTHS[v.width] ?? WIDTHS.full}`}>
              <Visualizer
                media={mediaEl}
                styleId={v.style}
                theme={resolveVizTheme(v.theme)}
                dropStyle={v.drop}
                previewBurst={v.preview}
                glow={v.glow}
                cycle={v.cycle}
                move={v.move}
              />
            </div>
          </div>

          {v.logo && (
            <div className="pointer-events-none absolute inset-x-0 top-[15%] flex justify-center">
              <Logo />
            </div>
          )}

          {/* transport overlays the bottom edge; its shape comes from the chosen
              style, its colour + effects from the progress-bar scheme. In
              fullscreen it slides out of view when the chrome hides. */}
          <div
            className={`absolute inset-x-0 bottom-0 z-10 transition-transform duration-300 ${
              transportBg ? 'bg-[var(--p-title)]' : ''
            } ${chromeVisible ? 'translate-y-0' : 'translate-y-full'}`}
          >
            <Transport
              c={c}
              style={transportStyle}
              peaks={peaks}
              bar={barFx}
              settings={<PlayerMenu c={c} autoplayHint="track" />}
            />
          </div>
        </>
      )}
    </div>
  )
}
