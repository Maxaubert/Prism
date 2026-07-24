import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { formatTime } from '../lib/format'

// A real video player: a custom, auto-hiding transport (not <video controls>),
// a buffered + played scrub bar with hover-time, volume, speed, fullscreen, and
// full keyboard control. Built to feel like a proper media player, not a preview.

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const VOL_KEY = 'prism.volume'

function Svg({ children, size = 22 }: { children: ReactNode; size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      {children}
    </svg>
  )
}
const IconPlay = (
  <Svg>
    <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
  </Svg>
)
const IconPause = (
  <Svg>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </Svg>
)
const IconVol = (
  <Svg>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="M16 8.5a4 4 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M18.5 6a7 7 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </Svg>
)
const IconMute = (
  <Svg>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </Svg>
)
const IconFull = (
  <Svg>
    <path
      d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
)

export function VideoView({
  url,
  onToggleFullscreen
}: {
  url: string
  onToggleFullscreen: () => void
}): JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [vol, setVol] = useState(() => {
    const v = Number(localStorage.getItem(VOL_KEY))
    return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 1
  })
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [rateOpen, setRateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chromeOn, setChromeOn] = useState(true)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const [flash, setFlash] = useState<'play' | 'pause' | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Apply volume/rate to the element and remember volume.
  useEffect(() => {
    if (video.current) {
      video.current.volume = vol
      video.current.muted = muted
    }
    localStorage.setItem(VOL_KEY, String(vol))
  }, [vol, muted])
  useEffect(() => {
    if (video.current) video.current.playbackRate = rate
  }, [rate])

  const showChrome = useCallback(() => {
    setChromeOn(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (video.current && !video.current.paused) setChromeOn(false)
    }, 2600)
  }, [])

  const togglePlay = useCallback(() => {
    const v = video.current
    if (!v) return
    if (v.paused) {
      void v.play()
      setFlash('play')
    } else {
      v.pause()
      setFlash('pause')
    }
    setTimeout(() => setFlash(null), 450)
  }, [])

  const seekTo = useCallback((t: number) => {
    const v = video.current
    if (!v || !Number.isFinite(v.duration)) return
    v.currentTime = Math.max(0, Math.min(v.duration, t))
    setCur(v.currentTime)
  }, [])
  const seekBy = useCallback((d: number) => seekTo((video.current?.currentTime ?? 0) + d), [seekTo])
  const bumpVol = useCallback((d: number) => setVol((x) => Math.max(0, Math.min(1, +(x + d).toFixed(2)))), [])

  // Keyboard (video owns arrows for seek; App skips them for playable media).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault(); togglePlay(); showChrome(); break
        case 'ArrowRight': seekBy(5); showChrome(); break
        case 'ArrowLeft': seekBy(-5); showChrome(); break
        case 'l': seekBy(10); showChrome(); break
        case 'j': seekBy(-10); showChrome(); break
        case 'ArrowUp': e.preventDefault(); bumpVol(0.05); showChrome(); break
        case 'ArrowDown': e.preventDefault(); bumpVol(-0.05); showChrome(); break
        case 'm': setMuted((x) => !x); showChrome(); break
        case 'f': onToggleFullscreen(); break
        case '.': seekBy(1 / 30); break
        case ',': seekBy(-1 / 30); break
        case '>': setRate((r) => RATES[Math.min(RATES.length - 1, RATES.indexOf(r) + 1)] ?? r); break
        case '<': setRate((r) => RATES[Math.max(0, RATES.indexOf(r) - 1)] ?? r); break
        case 'Home': seekTo(0); break
        case 'End': seekTo(dur); break
        default:
          if (/^[0-9]$/.test(e.key)) seekTo((Number(e.key) / 10) * dur)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seekBy, bumpVol, seekTo, onToggleFullscreen, dur, showChrome])

  // Scrub bar interaction.
  const barFraction = (clientX: number): number => {
    const el = barRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }
  const onBarDown = (e: ReactPointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    seekTo(barFraction(e.clientX) * dur)
    const move = (ev: PointerEvent): void => seekTo(barFraction(ev.clientX) * dur)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const pct = dur > 0 ? (cur / dur) * 100 : 0
  const bufPct = dur > 0 ? (buffered / dur) * 100 : 0

  return (
    <div
      className="group relative flex h-full w-full items-center justify-center bg-black"
      onMouseMove={showChrome}
      onMouseLeave={() => playing && setChromeOn(false)}
      style={{ cursor: chromeOn ? 'default' : 'none' }}
    >
      <video
        ref={video}
        src={url}
        autoPlay
        className="max-h-full max-w-full"
        onClick={togglePlay}
        onDoubleClick={onToggleFullscreen}
        onPlay={() => { setPlaying(true); showChrome() }}
        onPause={() => { setPlaying(false); setChromeOn(true) }}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onProgress={(e) => {
          const v = e.currentTarget
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
        }}
        onError={() => setError('This video can’t be played (unsupported codec or corrupt file).')}
      />

      {/* center play/pause flash */}
      {(flash || (!playing && !error)) && (
        <div className="pointer-events-none absolute grid place-items-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <div className="scale-[1.6]">{playing ? IconPause : IconPlay}</div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-8 text-center text-sm text-[#c9ccd6]">
          {error}
        </div>
      )}

      {/* control bar */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pb-3 pt-10 transition-opacity duration-200 ${
          chromeOn ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* scrubber */}
        <div
          ref={barRef}
          className="pointer-events-auto group/bar relative mb-2 h-4 cursor-pointer"
          onPointerDown={onBarDown}
          onMouseMove={(e) => setHoverX(barFraction(e.clientX))}
          onMouseLeave={() => setHoverX(null)}
        >
          <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/25 transition-[height] group-hover/bar:h-[5px]">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${bufPct}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent-hi)]" style={{ width: `${pct}%` }} />
          </div>
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover/bar:opacity-100"
            style={{ left: `${pct}%` }}
          />
          {hoverX != null && (
            <div
              className="pointer-events-none absolute bottom-4 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
              style={{ left: `${hoverX * 100}%` }}
            >
              {formatTime(hoverX * dur)}
            </div>
          )}
        </div>

        {/* buttons row */}
        <div className="pointer-events-auto flex items-center gap-3 text-white">
          <button className="grid place-items-center hover:text-[var(--color-accent-hi)]" onClick={togglePlay} title="Play/Pause (Space)">
            {playing ? IconPause : IconPlay}
          </button>

          <div className="group/vol flex items-center gap-2">
            <button className="grid place-items-center hover:text-[var(--color-accent-hi)]" onClick={() => setMuted((x) => !x)} title="Mute (M)">
              {muted || vol === 0 ? IconMute : IconVol}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : vol}
              onChange={(e) => { setVol(Number(e.target.value)); setMuted(false) }}
              className="h-1 w-0 cursor-pointer accent-[var(--color-accent-hi)] opacity-0 transition-all group-hover/vol:w-20 group-hover/vol:opacity-100"
            />
          </div>

          <span className="tabular-nums text-[13px] text-[#d7dae1]">
            {formatTime(cur)} <span className="text-white/40">/ {formatTime(dur)}</span>
          </span>

          <div className="flex-1" />

          <div className="relative">
            <button
              className="rounded px-2 py-0.5 text-[13px] font-semibold hover:text-[var(--color-accent-hi)]"
              onClick={() => setRateOpen((x) => !x)}
              title="Playback speed"
            >
              {rate}×
            </button>
            {rateOpen && (
              <div className="absolute bottom-8 right-0 flex flex-col rounded-lg bg-[#1b1e26] p-1 shadow-xl">
                {RATES.map((r) => (
                  <button
                    key={r}
                    className={`rounded px-3 py-1 text-left text-[13px] hover:bg-white/10 ${r === rate ? 'text-[var(--color-accent-hi)]' : ''}`}
                    onClick={() => { setRate(r); setRateOpen(false) }}
                  >
                    {r}×
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="grid place-items-center hover:text-[var(--color-accent-hi)]" onClick={onToggleFullscreen} title="Fullscreen (F)">
            {IconFull}
          </button>
        </div>
      </div>
    </div>
  )
}
