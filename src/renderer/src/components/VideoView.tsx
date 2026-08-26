import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useMediaControls } from '../lib/useMediaControls'
import { usePlayerPrefs } from '../lib/playerPrefs'
import { useSubtitles } from '../lib/useSubtitles'
import { useSidecarAudio } from '../lib/useSidecarAudio'
import { usePlayableVideo } from '../lib/usePlayableVideo'
import { Transport } from './Transport'
import { PlayerMenu } from './PlayerMenu'
import { IconFull } from './icons'
import { useWaveform } from '../lib/useWaveform'
import type { TransportStyle } from '../lib/transport'
import { useViz } from '../lib/vizStore'
import { resolveVizTheme } from '../lib/theme'

/** How long the controls stay after the last sign of life, in ms. */
const CHROME_IDLE = 2600

// The video player: the shared media hook + Transport, on a black stage with a
// video frame, an auto-hiding control overlay, click-to-play,
// and fullscreen. Everything transport-related lives in the shared pieces; this
// file only adds the video-specific stage behaviour.

export function VideoView({
  url,
  path,
  onToggleFullscreen,
  onAutoAdvance,
  transportStyle,
  transportBg
}: {
  url: string
  /** The file's real path, for finding sidecar subtitles next to it. */
  path: string
  onToggleFullscreen: () => void
  /** Autoplay's exit: the app moves to the next video in the folder. */
  onAutoAdvance: () => void
  transportStyle: TransportStyle
  /** How solid the band behind the controls is, 0-100%. */
  transportBg: number
}): JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  // A file Chromium cannot open at all is converted first, and what plays is
  // the copy. Everything downstream (subtitles, waveform, the audio decoder)
  // then deals with an ordinary mp4.
  const playable = usePlayableVideo(path, url)
  const src = playable.src
  const prefs = usePlayerPrefs()
  const subtitles = useSubtitles(path)
  const peaks = useWaveform(path, transportStyle === 'wave' || transportStyle === 'wavebold')
  // How solid the band behind the controls is, 0-100% (2026-08-25). Opaque by
  // default - the bar as it has always looked - and a slider all the way down
  // to nothing, where the picture runs to the bottom of the frame. Three styles
  // never had a band and still do not: an edge hairline, an outline rail and a
  // floating capsule are their own shape.
  const bandable =
    transportStyle !== 'edge' && transportStyle !== 'outline' && transportStyle !== 'island'
  const bandPct = bandable ? Math.max(0, Math.min(100, transportBg)) : 0
  const v = useViz()
  const barFx = {
    palette: resolveVizTheme(v.barTheme).palette,
    glow: v.barGlow,
    cycle: v.barCycle,
    move: v.barMove
  }
  const [chromeOn, setChromeOn] = useState(true)
  /**
   * When the last thing happened. The chrome hides on a CLOCK reading this,
   * not on a timer that each wake cancels and replaces (2026-08-25): a timer
   * only has to miss one reset to leave the controls up for ever, and one
   * sticky flag - a menu that closed without saying so, a pointer that
   * entered the bar and never left because the bar unmounted under it - was
   * enough to do exactly that.
   */
  // Zero until the first effect: reading the clock during render is impure.
  const lastWake = useRef(0)
  // The settings menu pins the chrome while it is open: an invisible menu
  // would keep eating clicks and the first Escape.
  const menuOpen = useRef(false)

  const showChrome = useCallback(() => {
    lastWake.current = Date.now()
    setChromeOn(true)
  }, [])

  /** The clock. Hiding is decided from what is TRUE at the moment it fires -
   *  the element's own :hover included - so nothing can be left stuck on. */
  useEffect(() => {
    lastWake.current = Date.now()
    const t = window.setInterval(() => {
      if (Date.now() - lastWake.current < CHROME_IDLE) return
      const el = video.current
      if (!el || el.paused || menuOpen.current) return
      // Reaching for the scrubber and pausing your hand should not make the
      // thing you are reaching for disappear. Asked of the DOM, so it cannot
      // be a flag that failed to clear.
      if (document.querySelector('[data-transport]:hover')) return
      setChromeOn(false)
    }, 250)
    return () => window.clearInterval(t)
  }, [video])

  const onMenuOpen = useCallback(
    (open: boolean) => {
      const was = menuOpen.current
      menuOpen.current = open
      // Opening pins the chrome; a real close restarts the clock. A close
      // reported while it was ALREADY closed is the menu unmounting with the
      // bar - and waking on that put the controls straight back up every time
      // they hid, which is the third form this same bug took.
      if (open || was) showChrome()
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

  /**
   * Activity, heard at the WINDOW rather than only on this div (2026-08-25).
   *
   * The controls used to wake on React's own onMouseMove, which only fires for
   * events that reach this element and bubble. In fullscreen that is one
   * assumption too many: the pointer can land on the black around a letterboxed
   * picture, on an overlay, or on a surface that stops propagation, and the
   * chrome then stays hidden however hard you wave. Capture-phase listeners on
   * the window hear the move wherever it lands, and any keystroke counts too,
   * so a paused film always shows its transport even if something else claimed
   * the key first.
   */
  useEffect(() => {
    const wake = (): void => showChrome()
    window.addEventListener('pointermove', wake, { capture: true, passive: true })
    window.addEventListener('keydown', wake, true)
    document.addEventListener('fullscreenchange', wake)
    return () => {
      window.removeEventListener('pointermove', wake, true)
      window.removeEventListener('keydown', wake, true)
      document.removeEventListener('fullscreenchange', wake)
    }
  }, [showChrome])

  // Click toggles play quietly - no centre icon at all (owner decision,
  // 2026-08-22): the transport says the state, the picture stays clean.
  const clickToggle = (): void => c.togglePlay()

  // Sound for tracks Chromium refuses to decode (Dolby Digital, DTS, TrueHD):
  // main decodes them and this plays the result beside the picture. The video
  // element needs no muting - it has no decoder for that track either, which
  // is the entire problem.
  const {
    state: sidecarState,
    url: sidecarUrl,
    ref: sidecarRef,
    videoCodec
  } = useSidecarAudio(path, video, c.vol, c.muted)
  const [hushedUrl, setHushedUrl] = useState<string | null>(null)
  const silent = sidecarState === 'unavailable' && hushedUrl !== url

  // The other half of the same honesty. Prism decodes audio it cannot play,
  // but NOT video: MPEG-2, Xvid, WMV, Theora and ProRes all leave Chromium
  // with a file it will happily read the sound out of and show nothing for.
  // A black window with working sound is the most confusing possible result,
  // so name the codec that did it. Only when the file really has a picture:
  // an audio-only mkv is not broken, it just has no video.
  const [blindUrl, setBlindUrl] = useState<string | null>(null)
  const noPicture = blindUrl === url && hushedUrl !== url
  useEffect(() => {
    const el = video.current
    if (!el || !videoCodec || playable.converting || playable.converted) return
    const t = window.setInterval(() => {
      // readyState >= 2 means metadata AND a frame's worth of data has been
      // considered, so a zero width by then is a decoder that gave up.
      if (el.readyState >= 2) setBlindUrl(el.videoWidth === 0 ? url : null)
    }, 900)
    return () => window.clearInterval(t)
  }, [url, videoCodec, video, playable.converting, playable.converted])

  return (
    <div
      className="group relative flex h-full w-full items-center justify-center"
      // No mouse handlers here either, and for a measured reason: Chromium
      // fires `mousemove` when the layout changes under a STATIONARY cursor,
      // and the bar unmounting is such a change - so the controls hid and
      // woke themselves a frame later, for ever. Real movement arrives on the
      // window's pointermove, which content changes do not fire.
      style={{ cursor: chromeOn ? 'default' : 'none' }}
    >
      {playable.converting && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-[var(--p-bg)]/92 p-8">
          <div className="flex w-[min(420px,80%)] flex-col items-center gap-3 text-center">
            <div className="text-sm text-[var(--p-text)]">
              {playable.quick ? 'Repacking this video' : 'Converting this video'}
            </div>
            <div className="text-[12px] text-[var(--p-dim)]">
              {playable.quick
                ? 'Chromium cannot open this container, so its streams are being copied into one it can. This is quick.'
                : 'Chromium cannot decode this video, so Prism is re-encoding it once. The copy is kept, so this happens only the first time.'}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--p-line)]">
              <div
                className={`h-full rounded-full bg-[var(--p-accent)] ${playable.pct === null ? 'p-agent-run w-1/3' : 'transition-[width] duration-300'}`}
                style={playable.pct === null ? undefined : { width: `${playable.pct}%` }}
              />
            </div>
            <div className="text-[11px] tabular-nums text-[var(--p-dim2)]">
              {playable.pct === null ? 'working' : `${playable.pct}%`}
            </div>
          </div>
        </div>
      )}
      {playable.error && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-[var(--p-bg)]/92 p-8 text-center text-sm text-[var(--p-text-soft)]">
          This video could not be converted ({playable.error}).
        </div>
      )}
      {(silent || noPicture) && (
        <div
          role="status"
          className="pointer-events-auto absolute left-1/2 top-3 z-30 flex max-w-[min(560px,86%)] -translate-x-1/2 items-center gap-2 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-side-flat)]/95 px-3.5 py-1.5 text-[12px] text-[var(--p-text-soft)] shadow-[0_10px_28px_rgba(0,0,0,.45)]"
        >
          <svg
            viewBox="0 0 24 24"
            width={13}
            height={13}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            className="shrink-0 text-[var(--p-dim)]"
            aria-hidden
          >
            <path d="M4 9v6h4l5 4V5L8 9zM17 9l4 6m0-6-4 6" />
          </svg>
          <span className="min-w-0">
            {noPicture ? (
              <>
                No picture: Prism cannot decode this file&apos;s video
                {videoCodec ? ` (${videoCodec})` : ''}. The sound is unaffected.
              </>
            ) : (
              <>
                No sound: this file&apos;s audio needs a decoder Prism could not find. The picture
                is unaffected.
              </>
            )}
          </span>
          <button
            className="ml-1 shrink-0 rounded px-1 text-[var(--p-dim2)] hover:text-[var(--p-text)]"
            onClick={() => setHushedUrl(url)}
            aria-label="Dismiss"
            title="Dismiss"
          >
            <svg
              viewBox="0 0 24 24"
              width={11}
              height={11}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden
            >
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
        src={src}
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
          <track
            key={subtitles.vttUrl}
            default
            kind="subtitles"
            src={subtitles.vttUrl}
            label="Subtitles"
          />
        )}
      </video>

      {c.error && (
        <div className="absolute inset-0 grid place-items-center bg-[var(--p-bg)]/90 p-8 text-center text-sm text-[var(--p-text-soft)]">
          {c.error}
        </div>
      )}

      {/* The auto-hiding control overlay. MOUNTED and UNMOUNTED rather than
          faded in place: see prism-chrome-in in index.css - a layer that goes
          to opacity 0 inside a fullscreen element and comes back is composited
          once and never repainted, so the controls were painted at the right
          place and never appeared. */}
      {chromeOn && (
        <div
          data-transport
          // No mouse handlers of its own, deliberately: the bar UNMOUNTS when
          // the chrome hides, and an element removed under the pointer fires
          // its own mouseleave - wired to wake, that put the controls back up
          // the instant they went away, for ever. Moving the pointer already
          // wakes them (window listener), and resting on them is read from
          // :hover by the clock.
          // z-10 and a layer of its own, so nothing can order the picture over
          // the top of it.
          style={{
            animation: 'prism-chrome-in 180ms ease-out',
            ...(bandPct > 0
              ? { background: `color-mix(in srgb, var(--p-title) ${bandPct}%, transparent)` }
              : {}),
            // Once the band is faint the controls sit on whatever the film is
            // showing, and a white sky reads as well as a night scene only if
            // they carry their own shadow. Dropped again when the band is
            // solid enough to do the job itself.
            ...(bandPct < 55 ? { filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.85))' } : {})
          }}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
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
                subtitles={{
                  tracks: subtitles.tracks,
                  active: subtitles.active,
                  onPick: subtitles.pick
                }}
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
      )}
    </div>
  )
}
