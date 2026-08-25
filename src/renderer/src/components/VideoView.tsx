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
  // A file Chromium cannot open at all is converted first, and what plays is
  // the copy. Everything downstream (subtitles, waveform, the audio decoder)
  // then deals with an ordinary mp4.
  const playable = usePlayableVideo(path, url)
  const src = playable.src
  const prefs = usePlayerPrefs()
  const subtitles = useSubtitles(path)
  const peaks = useWaveform(src, transportStyle === 'wave' || transportStyle === 'wavebold')
  const solidBg = transportStyle !== 'edge' && transportStyle !== 'outline' && transportStyle !== 'island'
  const v = useViz()
  const barFx = { palette: resolveVizTheme(v.barTheme).palette, glow: v.barGlow, cycle: v.barCycle, move: v.barMove }
  const [chromeOn, setChromeOn] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The chrome never hides while the settings menu is open: an invisible menu
  // would keep eating clicks and the first Escape. Nor while the pointer is
  // resting ON the transport - reaching for the scrubber and pausing your hand
  // should not make the thing you are reaching for disappear.
  const menuOpen = useRef(false)
  const overBar = useRef(false)

  const showChrome = useCallback(() => {
    setChromeOn(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (video.current && !video.current.paused && !menuOpen.current && !overBar.current)
        setChromeOn(false)
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


  /* ------------------------------------------------------------------ *
   * TEMPORARY (2026-08-25): the fullscreen transport is reported dead on
   * the owner's machine and reproduces nowhere here - not with synthetic
   * input, not with the real Windows cursor, not on the same film, in
   * either fullscreen path. So rather than guess again, this writes what
   * the player actually sees to userData/prism-debug.log. Remove it the
   * moment the cause is known.
   * ------------------------------------------------------------------ */
  /** Fullscreen, as the DOM sees it. Drives the compositing mitigation below. */
  const [inFs, setInFs] = useState(false)
  useEffect(() => {
    const sync = (): void => setInFs(!!document.fullscreenElement)
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const dbgMoves = useRef(0)
  const dbgKeys = useRef<string[]>([])
  useEffect(() => {
    const log = (line: string): void => window.prism.debugLog?.(line)
    const move = (): void => {
      dbgMoves.current += 1
    }
    const key = (e: KeyboardEvent): void => {
      dbgKeys.current.push(e.key + (e.defaultPrevented ? '(claimed)' : ''))
    }
    const fsc = (): void =>
      log(
        `fullscreenchange el=${document.fullscreenElement?.className.slice(0, 40) ?? 'none'} ` +
          `inner=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`
      )
    window.addEventListener('pointermove', move, { capture: true, passive: true })
    window.addEventListener('keydown', key, true)
    document.addEventListener('fullscreenchange', fsc)
    log(`viewer mounted inner=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`)

    const tick = window.setInterval(() => {
      const el = video.current
      const bar = el?.parentElement?.querySelector('[data-transport]') as HTMLElement | null
      const r = bar?.getBoundingClientRect()
      const moves = dbgMoves.current
      const keys = dbgKeys.current.splice(0, 8).join(',')
      dbgMoves.current = 0
      // Only speak while there is something to say: in fullscreen, or when
      // input arrived. A quiet windowed player writes nothing.
      if (!document.fullscreenElement && !moves && !keys) return
      log(
        `fs=${!!document.fullscreenElement} chrome=${chromeOn} paused=${el?.paused} ` +
          `moves=${moves} keys=[${keys}] ` +
          `bar=${r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : 'missing'} ` +
          `op=${bar ? getComputedStyle(bar).opacity : '-'} vis=${bar ? getComputedStyle(bar).visibility : '-'} ` +
          `inner=${window.innerWidth}x${window.innerHeight} ` +
          `video=${el ? `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}` : 'none'}`
      )
    }, 1000)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('keydown', key, true)
      document.removeEventListener('fullscreenchange', fsc)
      window.clearInterval(tick)
    }
  }, [chromeOn, video])

  // Click toggles play quietly - no centre icon at all (owner decision,
  // 2026-08-22): the transport says the state, the picture stays clean.
  const clickToggle = (): void => c.togglePlay()

  // Sound for tracks Chromium refuses to decode (Dolby Digital, DTS, TrueHD):
  // main decodes them and this plays the result beside the picture. The video
  // element needs no muting - it has no decoder for that track either, which
  // is the entire problem.
  const { state: sidecarState, url: sidecarUrl, ref: sidecarRef, videoCodec } = useSidecarAudio(path, video, c.vol, c.muted)
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
      onMouseMove={showChrome}
      // Leaving hides it - but NOT in fullscreen, where there is nowhere else
      // to be: the pointer crossing onto the black around a letterboxed
      // picture, or onto another monitor, is not the user walking away.
      onMouseLeave={() =>
        c.playing && !menuOpen.current && !document.fullscreenElement && setChromeOn(false)
      }
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
          <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="shrink-0 text-[var(--p-dim)]" aria-hidden>
            <path d="M4 9v6h4l5 4V5L8 9zM17 9l4 6m0-6-4 6" />
          </svg>
          <span className="min-w-0">
            {noPicture ? (
              <>
                No picture: Prism cannot decode this file&apos;s video
                {videoCodec ? ` (${videoCodec})` : ''}. The sound is unaffected.
              </>
            ) : (
              <>No sound: this file&apos;s audio needs a decoder Prism could not find. The picture is unaffected.</>
            )}
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
        src={src}
        autoPlay
        loop={prefs.loop}
        // Autoplay: the folder is a playlist. Loop wins while both are on
        // (a looping video never ends, so this simply doesn't fire).
        onEnded={() => prefs.autoplay && onAutoAdvance()}
        // Fill the stage and letterbox only on the axis that needs it. max-w/max-h
        // would cap the video at its intrinsic size, so anything smaller than the
        // window (e.g. a 720p file fullscreened) sat boxed in on all four sides.
        // 0.999 while fullscreen, and this is not decoration (2026-08-25):
        // an exactly-opaque video is what lets Windows present the picture
        // through the video pipeline, and everything the page draws over it -
        // the transport - then stops appearing a few seconds into playback.
        // Asking for the faintest blend keeps the picture in the page's own
        // layer, where the controls can sit on top of it. Invisible to the
        // eye; costs a blend, only while fullscreen.
        style={inFs ? { opacity: 0.999 } : undefined}
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
        data-transport
        onMouseEnter={() => {
          overBar.current = true
          showChrome()
        }}
        onMouseLeave={() => {
          overBar.current = false
          showChrome()
        }}
        // z-10 and a layer of its own, so nothing can order the picture over
        // the top of it.
        style={{ transform: 'translateZ(0)' }}
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 transition-opacity duration-200 ${
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
