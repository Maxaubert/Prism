import { useRef, useState, type JSX, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { formatTime } from '../lib/format'
import { RATES, type MediaControls } from '../lib/useMediaControls'
import { IconMute, IconPause, IconPlay, IconVol } from './icons'

// The transport bar shared by every player: a buffered + played scrub bar with a
// hover-time tooltip and draggable thumb, play/pause, a hover-expand volume
// slider, the time readout, and a speed menu. `extra` slots a view-specific
// control on the right (the video player passes its fullscreen button).
//
// It reads its accent from the --color-accent-hi CSS token, so a future theme can
// recolour every player at once. This is one of the interchangeable chrome pieces.

export function Transport({ c, extra }: { c: MediaControls; extra?: ReactNode }): JSX.Element {
  const barRef = useRef<HTMLDivElement>(null)
  const [rateOpen, setRateOpen] = useState(false)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const { cur, dur, buffered, vol, muted, rate, playing } = c

  const barFraction = (clientX: number): number => {
    const el = barRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }
  const onBarDown = (e: ReactPointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    c.seekTo(barFraction(e.clientX) * dur)
    const move = (ev: PointerEvent): void => c.seekTo(barFraction(ev.clientX) * dur)
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
    <div className="pointer-events-auto w-full">
      {/* scrubber */}
      <div
        ref={barRef}
        className="group/bar relative mb-2 h-4 cursor-pointer"
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
        {hoverX != null && dur > 0 && (
          <div
            className="pointer-events-none absolute bottom-4 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
            style={{ left: `${hoverX * 100}%` }}
          >
            {formatTime(hoverX * dur)}
          </div>
        )}
      </div>

      {/* buttons row */}
      <div className="flex items-center gap-3 text-white">
        <button className="grid place-items-center hover:text-[var(--color-accent-hi)]" onClick={c.togglePlay} title="Play/Pause (Space)">
          {playing ? IconPause : IconPlay}
        </button>

        <div className="group/vol flex items-center gap-2">
          <button className="grid place-items-center hover:text-[var(--color-accent-hi)]" onClick={c.toggleMute} title="Mute (M)">
            {muted || vol === 0 ? IconMute : IconVol}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : vol}
            onChange={(e) => { c.setVol(Number(e.target.value)); if (muted) c.toggleMute() }}
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
                  onClick={() => { c.setRate(r); setRateOpen(false) }}
                >
                  {r}×
                </button>
              ))}
            </div>
          )}
        </div>

        {extra}
      </div>
    </div>
  )
}
