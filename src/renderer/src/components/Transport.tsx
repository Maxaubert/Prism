import { useRef, useState, type JSX, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { formatTime } from '../lib/format'
import { MAX_VOL, type MediaControls } from '../lib/useMediaControls'
import { IconMute, IconPause, IconPlay, IconVol } from './icons'
import type { TransportStyle } from '../lib/transport'
import { paletteAt } from '../lib/viz/core'

// The transport bar shared by every player. One of ten shapes (chosen in
// Settings) draws the same set of controls — a scrub bar with hover-time and
// draggable thumb, play/pause, a hover-expand volume slider, the time readout
// and the player-settings cog (`settings`, where the speed button used to be:
// speed lives inside that menu now). `extra` slots a view-specific control on
// the right (the video player passes its fullscreen button). `peaks` feeds the
// waveform shapes.
//
// The played progress fill is coloured by its own scheme + effects (`bar`), the
// same colour system as the visualizer but picked independently; the controls use
// --color-accent-hi.

/** The progress bar's colour scheme + effect toggles (picked in Settings). */
export interface BarFx {
  palette: string[]
  glow: boolean
  cycle: boolean
  move: boolean
}

type ScrubLook =
  | { kind: 'line'; h: number; glow?: boolean; top?: boolean; ballAbove?: boolean }
  | { kind: 'wave'; bold?: boolean }
  | { kind: 'seg' }

/** The seek surface: owns the drag/seek + hover-time, renders line / waveform /
 *  segments. Placed differently by each style, but always the same behaviour. */
function Scrubber({
  c,
  look,
  peaks,
  bar,
  className = ''
}: {
  c: MediaControls
  look: ScrubLook
  peaks: number[]
  bar: BarFx
  className?: string
}): JSX.Element {
  const barRef = useRef<HTMLDivElement>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const { cur, dur, buffered } = c
  const pct = dur > 0 ? (cur / dur) * 100 : 0
  const bufPct = dur > 0 ? (buffered / dur) * 100 : 0

  // Colour the played fill by the scheme + effects. Move scrolls a cyclic
  // gradient; cycle rotates the hue (a CSS filter animation); glow adds bloom.
  const grad = bar.palette.length > 1 ? `linear-gradient(90deg, ${(bar.move ? [...bar.palette, bar.palette[0]] : bar.palette).join(', ')})` : bar.palette[0]
  const glowColor = bar.palette[bar.palette.length - 1]
  const lineAnim = [bar.cycle && 'bar-hue 9s linear infinite', bar.move && 'bar-slide 6s linear infinite'].filter(Boolean).join(', ') || undefined
  const groupAnim = bar.cycle ? 'bar-hue 9s linear infinite' : undefined
  const barAt = (frac: number): string => paletteAt(bar.palette, frac)

  const frac = (clientX: number): number => {
    const el = barRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }
  const onDown = (e: ReactPointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    c.seekTo(frac(e.clientX) * dur)
    const move = (ev: PointerEvent): void => c.seekTo(frac(ev.clientX) * dur)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const tooltip =
    hoverX != null && dur > 0 ? (
      <div
        className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--p-text)]"
        style={{ left: `${hoverX * 100}%` }}
      >
        {formatTime(hoverX * dur)}
      </div>
    ) : null

  return (
    <div
      ref={barRef}
      className={`group/bar relative cursor-pointer ${className}`}
      onPointerDown={onDown}
      onMouseMove={(e) => setHoverX(frac(e.clientX))}
      onMouseLeave={() => setHoverX(null)}
    >
      {look.kind === 'line' && (
        <>
          <div
            className="absolute inset-x-0 rounded-full bg-[var(--p-divider)] transition-[height]"
            style={look.top ? { top: 0, height: look.h } : { top: '50%', height: look.h, transform: 'translateY(-50%)' }}
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--p-divider)]" style={{ width: `${bufPct}%` }} />
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${pct}%`,
                background: grad,
                backgroundSize: bar.move ? '200% 100%' : undefined,
                boxShadow: bar.glow || look.glow ? `0 0 9px ${glowColor}` : undefined,
                animation: lineAnim
              }}
            />
          </div>
          <div
            className={`absolute h-3 w-3 -translate-x-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover/bar:opacity-100 ${
              look.ballAbove ? '' : '-translate-y-1/2'
            }`}
            // ballAbove rests the ball ON the line instead of centring across
            // it: a line pinned to the window's bottom edge would otherwise
            // sink half the ball below the frame, clipped when maximised.
            style={
              look.ballAbove
                ? { left: `${pct}%`, bottom: 0 }
                : { left: `${pct}%`, top: look.top ? look.h / 2 : '50%' }
            }
          />
        </>
      )}

      {look.kind === 'wave' && (
        <div className="flex h-full items-center gap-[2px]" style={{ animation: groupAnim }}>
          {(peaks.length ? peaks : FALLBACK_WAVE).map((p, i, arr) => {
            const played = (i / arr.length) * 100 <= pct
            const col = played ? barAt(i / arr.length) : 'rgba(255,255,255,.2)'
            return (
              <div
                key={i}
                className="flex-1 rounded-[1px]"
                style={{
                  height: `${(look.bold ? 22 : 16) * p + (look.bold ? 8 : 5)}px`,
                  background: col,
                  boxShadow: played && bar.glow ? `0 0 4px ${col}` : undefined
                }}
              />
            )
          })}
        </div>
      )}

      {look.kind === 'seg' && (
        <div className="flex h-full items-center gap-[3px]" style={{ animation: groupAnim }}>
          {SEG.map((_, i) => {
            const lit = (i / SEG.length) * 100 <= pct
            const col = lit ? barAt(i / SEG.length) : 'rgba(255,255,255,.14)'
            return (
              <div
                key={i}
                className="h-1.5 flex-1 rounded-[2px]"
                style={{ background: col, boxShadow: lit && bar.glow ? `0 0 4px ${col}` : undefined }}
              />
            )
          })}
        </div>
      )}

      {tooltip}
    </div>
  )
}

const SEG = Array.from({ length: 48 })
// Shown by the waveform styles until the real peaks finish decoding.
const FALLBACK_WAVE = Array.from({ length: 120 }, (_, i) => 0.35 + 0.5 * Math.abs(Math.sin(i * 0.5) * Math.cos(i * 0.17)))

/* ---------- reusable control bits ---------- */

function PlayBtn({ c, square }: { c: MediaControls; square?: boolean }): JSX.Element {
  const glyph = c.playing ? IconPause : IconPlay
  if (square)
    return (
      <button
        className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--color-accent-hi)] text-[var(--p-on-accent)] hover:brightness-110"
        onClick={c.togglePlay}
        title="Play/Pause (Space)"
      >
        {glyph}
      </button>
    )
  return (
    <button className="grid place-items-center hover:text-[var(--color-accent-hi)]" onClick={c.togglePlay} title="Play/Pause (Space)">
      {glyph}
    </button>
  )
}

/**
 * Volume: a column that rises from the button (owner, 2026-08-27), where the
 * old slider grew sideways and pushed the time readout about.
 *
 * It runs to 200%, VLC-style, and says so: past 100% the loudness is a gain
 * node rather than the element's own volume (lib/audio), and a number that can
 * exceed 100 has to be readable or it is just a longer slider. The readout
 * doubles as the way back to 100%.
 */
function VolHover({ c, bare }: { c: MediaControls; bare?: boolean }): JSX.Element {
  const pct = Math.round((c.muted ? 0 : c.vol) * 100)
  return (
    <div className="group/vol relative flex items-center">
      <button
        className="grid place-items-center hover:text-[var(--color-accent-hi)]"
        onClick={c.toggleMute}
        title={`Mute (M) - now ${pct}%`}
      >
        {c.muted || c.vol === 0 ? IconMute : IconVol}
      </button>
      {/* Anchored to the button, hidden until hovered, and TOUCHING it: the gap
          is padding INSIDE this box (pb-2), not a margin below it, so crossing
          from the icon to the column never leaves the hover area. A margin put
          dead space in the way and the column closed on the way to it. */}
      <div
        className={`pointer-events-none absolute bottom-full left-1/2 z-30 hidden -translate-x-1/2 flex-col items-center gap-1.5 px-1.5 pb-2 pt-2 group-hover/vol:pointer-events-auto group-hover/vol:flex ${
          bare
            ? // The band behind the controls is off, so the column brings no
              // slab of its own: it sits on the film and carries a shadow, the
              // same bargain the transport itself makes at low opacity.
              '[filter:drop-shadow(0_1px_3px_rgba(0,0,0,.85))]'
            : 'rounded-full border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] shadow-[0_8px_20px_rgba(0,0,0,.45)]'
        }`}
      >
        <span
          className={`cursor-pointer select-none text-[10px] tabular-nums ${
            pct > 100 ? 'text-[var(--color-accent-hi)]' : 'text-[var(--p-dim)]'
          }`}
          onClick={() => c.setVol(1)}
          title="Back to 100%"
        >
          {pct}
        </span>
        <input
          type="range"
          min={0}
          max={MAX_VOL}
          step={0.01}
          value={c.muted ? 0 : c.vol}
          onChange={(e) => {
            c.setVol(Number(e.target.value))
            if (c.muted) c.toggleMute()
          }}
          aria-label="Volume"
          // The standard vertical range: bottom is quiet, top is loud.
          style={{ writingMode: 'vertical-lr', direction: 'rtl', width: '14px', height: '84px' }}
          className="cursor-pointer accent-[var(--color-accent-hi)]"
        />
      </div>
    </div>
  )
}

function Time({ c, big }: { c: MediaControls; big?: boolean }): JSX.Element {
  return (
    <span className={`tabular-nums ${big ? 'text-[15px] font-semibold' : 'text-[13px]'} text-[#d7dae1]`}>
      {formatTime(c.cur)} <span className="text-[var(--p-text)]/40">/ {formatTime(c.dur)}</span>
    </span>
  )
}

/* ---------- the transport, composed per style ---------- */

export function Transport({
  c,
  style,
  peaks,
  bar,
  bare,
  settings,
  extra
}: {
  c: MediaControls
  style: TransportStyle
  peaks: number[]
  bar: BarFx
  /** No band behind the controls (the background slider is at 0), so the
   *  volume column must not bring one of its own. */
  bare?: boolean
  /** The player-settings cog (speed, loop, autoplay, subtitles). */
  settings?: ReactNode
  extra?: ReactNode
}): JSX.Element {
  // The standard control row shared by most styles.
  const stdRow = (
    <div className="flex items-center gap-3 text-[var(--p-text)]">
      <PlayBtn c={c} />
      <VolHover c={c} bare={bare} />
      <Time c={c} />
      <div className="flex-1" />
      {settings}
      {extra}
    </div>
  )
  const boldRow = (
    <div className="flex items-center gap-4 text-[var(--p-text)]">
      <PlayBtn c={c} square />
      <Time c={c} big />
      <div className="flex-1" />
      <VolHover c={c} bare={bare} />
      {settings}
      {extra}
    </div>
  )

  switch (style) {
    case 'edge':
      return (
        <div className="pointer-events-auto w-full bg-gradient-to-t from-black/80 to-transparent px-4 pb-0 pt-10">
          <div className="mb-3 px-0">{stdRow}</div>
          <Scrubber c={c} look={{ kind: 'line', h: 2, glow: true, ballAbove: true }} peaks={peaks} bar={bar} className="h-[2px]" />
        </div>
      )

    case 'pill':
      return (
        <div className="pointer-events-auto w-full px-4 pb-2.5 pt-2.5">
          <Scrubber c={c} look={{ kind: 'line', h: 8, top: true }} peaks={peaks} bar={bar} className="mb-3 h-3" />
          {stdRow}
        </div>
      )

    case 'inline':
      return (
        <div className="pointer-events-auto flex w-full items-center gap-3 px-4 py-2.5 text-[var(--p-text)]">
          <PlayBtn c={c} />
          <span className="tabular-nums text-[12.5px] text-[#d7dae1]">{formatTime(c.cur)}</span>
          <Scrubber c={c} look={{ kind: 'line', h: 4 }} peaks={peaks} bar={bar} className="h-3.5 flex-1" />
          <span className="tabular-nums text-[12.5px] text-[var(--p-text)]/50">{formatTime(c.dur)}</span>
          <VolHover c={c} bare={bare} />
          {settings}
          {extra}
        </div>
      )

    case 'island':
      return (
        <div className="pointer-events-none flex w-full justify-center pb-4">
          <div className="pointer-events-auto flex items-center gap-3.5 rounded-full border border-[color:var(--p-divider)] bg-[#14161e]/75 px-4 py-2.5 text-[var(--p-text)] shadow-[0_12px_34px_rgba(0,0,0,.5)] backdrop-blur-md">
            <PlayBtn c={c} />
            <Scrubber c={c} look={{ kind: 'line', h: 4 }} peaks={peaks} bar={bar} className="h-3 w-40" />
            <Time c={c} />
            {settings}
            {extra}
          </div>
        </div>
      )

    case 'wave':
      return (
        <div className="pointer-events-auto w-full px-4 pb-2.5 pt-1.5">
          <Scrubber c={c} look={{ kind: 'wave' }} peaks={peaks} bar={bar} className="mb-1.5 h-[38px]" />
          {stdRow}
        </div>
      )

    case 'outline':
      return (
        <div className="pointer-events-auto w-full bg-gradient-to-t from-[#0d0f14]/90 to-transparent px-4 pb-3.5 pt-8">
          <Scrubber c={c} look={{ kind: 'line', h: 2, glow: true }} peaks={peaks} bar={bar} className="mb-3 h-[2px]" />
          {stdRow}
        </div>
      )

    case 'bold':
      return (
        <div className="pointer-events-auto w-full px-0 pb-0 pt-0">
          <Scrubber c={c} look={{ kind: 'line', h: 5, top: true }} peaks={peaks} bar={bar} className="h-[5px]" />
          <div className="px-4 pb-3.5 pt-3">{boldRow}</div>
        </div>
      )

    case 'segments':
      return (
        <div className="pointer-events-auto w-full px-4 pb-2.5 pt-2.5">
          <Scrubber c={c} look={{ kind: 'seg' }} peaks={peaks} bar={bar} className="mb-2.5 h-1.5" />
          {stdRow}
        </div>
      )

    case 'wavebold':
      return (
        <div className="pointer-events-auto w-full px-0 pt-1.5">
          <Scrubber c={c} look={{ kind: 'wave', bold: true }} peaks={peaks} bar={bar} className="h-[50px] px-4" />
          <div className="px-4 pb-3.5 pt-0.5">{boldRow}</div>
        </div>
      )

    case 'slim':
    default:
      return (
        <div className="pointer-events-auto w-full">
          <Scrubber c={c} look={{ kind: 'line', h: 3, top: true }} peaks={peaks} bar={bar} className="h-2.5" />
          <div className="flex items-center gap-3 px-4 pb-2.5 pt-1.5 text-[var(--p-text)]">
            <PlayBtn c={c} />
            <VolHover c={c} bare={bare} />
            <Time c={c} />
            <div className="flex-1" />
            {settings}
            {extra}
          </div>
        </div>
      )
  }
}
