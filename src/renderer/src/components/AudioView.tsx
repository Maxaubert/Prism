import { useCallback, useEffect, useRef, useState, type JSX, type SyntheticEvent } from 'react'
import { RATES, useMediaControls } from '../lib/useMediaControls'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { fileVerbs, stepVerbs, tickIf } from '../lib/fileVerbs'
import { usePlayerPrefs } from '../lib/playerPrefs'
import { Transport } from './Transport'
import { PlayerMenu } from './PlayerMenu'
import { Visualizer } from './Visualizer'
import { VolumeReadout } from './VolumeReadout'
import { useWaveform } from '../lib/useWaveform'
import type { TransportStyle } from '../lib/transport'
import { resolveVizTheme } from '../lib/theme'
import { useViz, WIDTHS } from '../lib/vizStore'
import { useDecodedSource } from '../lib/useDecodedSource'
import { wasPlaying } from '../lib/playState'
import { useBackgroundPause } from '../lib/useBackgroundPause'

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
  path,
  name,
  fullscreen,
  onToggleFullscreen,
  onAutoAdvance,
  onStep,
  canStep,
  transportStyle,
  background = false,
  volumeKey
}: {
  url: string
  /** The file's real path, for asking main whether Chromium can play it. */
  path: string
  name: string
  fullscreen: boolean
  onToggleFullscreen: () => void
  /** Autoplay's exit: the app moves to the next track in the folder. */
  onAutoAdvance: () => void
  /** Next/Previous TRACK, from the menu. Same rule as autoplay: the next file
   *  of this kind, stepping over photos and documents. */
  onStep?: (dir: 1 | -1) => void
  canStep?: (dir: 1 | -1) => boolean
  transportStyle: TransportStyle
  /** Mounted but not on screen: another tab is in front. The track plays on,
   *  with no controls, no keyboard and no visualizer - see lib/mediaDeck. */
  background?: boolean
  /** Whose volume this is: the tab's, for the session (lib/tabVolume). */
  volumeKey?: string
}): JSX.Element {
  const v = useViz()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // See VolumeReadout: a timestamp, so every notch restarts one clock.
  const [volFlash, setVolFlash] = useState(0)
  const prefs = usePlayerPrefs()
  // Apple Lossless, WMA, AC-3 and friends arrive decoded; everything Chromium
  // can play is left exactly as it was.
  const { src, synthesising, failed: synthFailed } = useDecodedSource(path, url)
  const peaks = useWaveform(path, !background && (transportStyle === 'wave' || transportStyle === 'wavebold'))
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
  // The transport never slides away while the settings menu is open: a menu
  // that left the screen would still own the first Escape.
  const menuOpen = useRef(false)
  const showChrome = useCallback(() => {
    setChromeOn(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (fullscreen)
      hideTimer.current = setTimeout(() => {
        if (!menuOpen.current) setChromeOn(false)
      }, 2600)
  }, [fullscreen])

  const onMenuOpen = useCallback(
    (open: boolean) => {
      menuOpen.current = open
      showChrome() // opening pins it; closing restarts the hide clock
    },
    [showChrome]
  )

  useBackgroundPause(audioRef)

  const c = useMediaControls(audioRef, {
    onFullscreen: onToggleFullscreen,
    onActivity: showChrome,
    errorMsg: `“${name}” can’t be played (unsupported codec or corrupt file).`,
    resumeKey: url,
    keys: !background,
    volumeKey,
    onVolume: () => setVolFlash(Date.now())
  })

  // Entering fullscreen arms the auto-hide; leaving it clears the timer. Chrome is
  // always shown windowed (see chromeVisible), so the effect never setStates there.
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (fullscreen) {
      hideTimer.current = setTimeout(() => {
        if (!menuOpen.current) setChromeOn(false)
      }, 2600)
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [fullscreen])
  const chromeVisible = !fullscreen || chromeOn

  /**
   * The audio stage's menu (2026-08-30).
   *
   * A strict subset of the video's, for the reason the video's own rows were
   * trimmed: play/pause and fullscreen are a click and a double-click away
   * already. What is left is what you cannot otherwise reach without leaving
   * the file - the next track, the speed, and where the thing lives.
   */
  const menuItems = (): MenuItem[] => [
    ...(onStep && canStep ? stepVerbs('track', onStep, canStep) : []),
    {
      label: 'Speed',
      // The hint is the current RATE, not a shortcut: the row says what the
      // speed IS, which is the reason to open it.
      hint: `${c.rate.toFixed(2)}x`,
      children: RATES.map((r) => ({
        label: r === 1 ? 'Normal' : `${r}x`,
        icon: tickIf(Math.abs(c.rate - r) < 0.001),
        onPick: () => c.setRate(r)
      }))
    },
    ...fileVerbs(path)
  ]

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      onMouseMove={showChrome}
      onContextMenu={(e) => {
        if (background) return
        e.preventDefault()
        showChrome()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      // The wheel is the volume here too, and the only way past 100%: the
      // gesture should not change because the file has no picture.
      onWheel={(e) => {
        if (background) return
        c.bumpVol(e.deltaY < 0 ? 0.05 : -0.05)
        showChrome()
      }}
      style={{ cursor: chromeVisible ? undefined : 'none' }}
    >
      {!background && <VolumeReadout flash={volFlash} vol={c.vol} muted={c.muted} />}
      {menu && !background && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
      )}
      {(synthesising || synthFailed) && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-[var(--p-bg)]/90 p-8 text-center">
          <div className="max-w-[26rem] text-sm text-[var(--p-text-soft)]">
            {synthesising
              ? 'Synthesising this score. A MIDI file holds no sound of its own, so Prism is playing it through its instrument bank.'
              : 'Prism could not synthesise this score.'}
          </div>
        </div>
      )}
      <audio
        ref={setMedia}
        // undefined, not "": an empty src resolves against the page and the
        // element reports an error before the rendering can arrive.
        src={src || undefined}
        crossOrigin="anonymous"
        // Play only what was ALREADY playing (2026-08-28, owner decision):
        // opening a file does not start it, and neither does restoring a
        // window full of tabs. A file whose player is being rebuilt mid-play
        // (a change of kind, a split view opening) carries on, and the
        // playlist records its own intent - see lib/playState.
        autoPlay={wasPlaying(url)}
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
                // A hidden tab draws nothing: the analyser and its animation
                // frame are for a canvas somebody is looking at.
                media={background ? null : mediaEl}
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
              settings={<PlayerMenu c={c} autoplayHint="track" onOpenChange={onMenuOpen} />}
            />
          </div>
        </>
      )}
    </div>
  )
}
