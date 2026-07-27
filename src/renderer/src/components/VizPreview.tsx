import { useId, type JSX } from 'react'

// Clean SCHEMATIC previews of each visualizer style - deliberately a simple mockup
// (like the progress-bar picker), drawn in SVG so it reads clearly and scales to
// any card size, rather than a heavy live render. It conveys the shape, not the
// exact pixels; the real thing plays in the viewer.

const VB_W = 120
const VB_H = 64
const X0 = 8
const X1 = 112
const SPAN = X1 - X0
const BASE = 56
const MAXH = BASE - 8 // 48
const CY = 32

// A fixed, natural-looking spectrum profile shared by the bar styles.
const P = [
  0.34, 0.52, 0.42, 0.66, 0.82, 0.56, 0.44, 0.7, 0.92, 0.62, 0.48,
  0.6, 0.78, 0.54, 0.4, 0.64, 0.86, 0.5, 0.44, 0.72, 0.58, 0.36
]
const N = P.length
const step = SPAN / N
const bw = step * 0.62
const cxOf = (i: number): number => X0 + (i + 0.5) * step

// Which archetype each style id draws as.
type Kind =
  | 'bars'
  | 'outline'
  | 'mirror'
  | 'mirrorOutline'
  | 'caps'
  | 'lines'
  | 'grid'
  | 'wave'
  | 'ring'
  | 'roundOutline'
  | 'roundSolid'
const KIND: Record<string, { kind: Kind }> = {
  'solid-bars': { kind: 'bars' },
  'outline-bars': { kind: 'outline' },
  'chrome-bars': { kind: 'mirror' },
  'mirror-outline': { kind: 'mirrorOutline' },
  'mirror-caps': { kind: 'caps' },
  needles: { kind: 'lines' },
  'clean-wall': { kind: 'grid' },
  segments: { kind: 'grid' },
  liquid: { kind: 'wave' },
  ripples: { kind: 'ring' },
  'outline-round': { kind: 'roundOutline' }, // "round" = rounded-top (capsule) bars
  'solid-round': { kind: 'roundSolid' }
}

function bars(g: string, outline: boolean): JSX.Element[] {
  return P.map((h, i) => {
    const hh = h * MAXH
    return (
      <rect
        key={i}
        x={cxOf(i) - bw / 2}
        y={BASE - hh}
        width={bw}
        height={hh}
        rx="1.2"
        fill={outline ? 'none' : g}
        stroke={outline ? g : 'none'}
        strokeWidth={outline ? 1.2 : 0}
      />
    )
  })
}

// Bars with a semicircular (capsule) top and flat base — the "Round" styles.
function roundedBars(g: string, outline: boolean): JSX.Element[] {
  const r = bw / 2
  return P.map((h, i) => {
    const x = cxOf(i) - bw / 2
    const hh = Math.max(bw + 1, h * MAXH)
    const top = BASE - hh
    const d = `M ${x} ${BASE} L ${x} ${top + r} A ${r} ${r} 0 0 1 ${x + bw} ${top + r} L ${x + bw} ${BASE} Z`
    return (
      <path
        key={i}
        d={d}
        fill={outline ? 'none' : g}
        stroke={outline ? g : 'none'}
        strokeWidth={outline ? 1.3 : 0}
        strokeLinejoin="round"
      />
    )
  })
}

function mirror(g: string, outline: boolean): JSX.Element[] {
  return P.map((h, i) => {
    const hh = h * 22
    return (
      <rect
        key={i}
        x={cxOf(i) - bw / 2}
        y={CY - hh}
        width={bw}
        height={hh * 2}
        rx="1.2"
        fill={outline ? 'none' : g}
        stroke={outline ? g : 'none'}
        strokeWidth={outline ? 1.2 : 0}
      />
    )
  })
}

function caps(g: string): JSX.Element[] {
  return P.flatMap((h, i) => {
    const cx = cxOf(i)
    const hh = h * 22
    return [
      <line key={`l${i}`} x1={cx} y1={CY - hh} x2={cx} y2={CY + hh} stroke={g} strokeWidth={bw * 0.8} strokeOpacity="0.16" />,
      <rect key={`t${i}`} x={cx - bw / 2} y={CY - hh - 1.1} width={bw} height="2.2" rx="1.1" fill={g} />,
      <rect key={`b${i}`} x={cx - bw / 2} y={CY + hh - 1.1} width={bw} height="2.2" rx="1.1" fill={g} />
    ]
  })
}

function lines(g: string): JSX.Element[] {
  return P.map((h, i) => {
    const cx = cxOf(i)
    const hh = h * 22
    return <line key={i} x1={cx} y1={CY - hh} x2={cx} y2={CY + hh} stroke={g} strokeWidth="1.5" strokeLinecap="round" />
  })
}

function grid(g: string): JSX.Element[] {
  const ch = MAXH / 8
  return P.flatMap((h, i) => {
    const x = cxOf(i) - bw / 2
    const cells = Math.max(1, Math.round(h * 7))
    return Array.from({ length: cells }, (_, c) => (
      <rect key={`${i}-${c}`} x={x} y={BASE - (c + 1) * ch + 0.9} width={bw} height={ch - 1.8} rx="0.8" fill={g} />
    ))
  })
}

function wave(g: string): JSX.Element {
  const amps = [7, 11, 9, 15, 11, 17, 12, 14, 9, 12, 8]
  const n = amps.length
  const xs = amps.map((_, k) => X0 + (k * SPAN) / (n - 1))
  const yt = (k: number): number => CY - amps[k]
  const yb = (k: number): number => CY + amps[k]
  let d = `M ${xs[0]} ${yt(0)}`
  for (let k = 1; k < n - 1; k++) {
    d += ` Q ${xs[k]} ${yt(k)} ${(xs[k] + xs[k + 1]) / 2} ${(yt(k) + yt(k + 1)) / 2}`
  }
  d += ` L ${xs[n - 1]} ${yt(n - 1)} L ${xs[n - 1]} ${yb(n - 1)}`
  for (let k = n - 2; k > 0; k--) {
    d += ` Q ${xs[k]} ${yb(k)} ${(xs[k] + xs[k - 1]) / 2} ${(yb(k) + yb(k - 1)) / 2}`
  }
  d += ` L ${xs[0]} ${yb(0)} Z`
  return <path d={d} fill={g} />
}

function ring(g: string): JSX.Element[] {
  const NR = 46
  const cx = 60
  const cy = CY
  const rIn = 12
  const len = 8.5 // uniform ray length (Halo)
  return Array.from({ length: NR }, (_, k) => {
    const ang = (k / NR) * Math.PI * 2 - Math.PI / 2
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    return (
      <line
        key={k}
        x1={cx + c * rIn}
        y1={cy + s * rIn}
        x2={cx + c * (rIn + len)}
        y2={cy + s * (rIn + len)}
        stroke={g}
        strokeWidth={1.1}
        strokeLinecap="round"
      />
    )
  })
}

export function VizPreview({ styleId }: { styleId: string }): JSX.Element {
  const gid = useId()
  const g = `url(#${gid})`
  const spec = KIND[styleId] ?? { kind: 'bars' as const }
  const isRing = spec.kind === 'ring'

  let content: JSX.Element | JSX.Element[]
  switch (spec.kind) {
    case 'outline':
      content = bars(g, true)
      break
    case 'mirror':
      content = mirror(g, false)
      break
    case 'mirrorOutline':
      content = mirror(g, true)
      break
    case 'caps':
      content = caps(g)
      break
    case 'lines':
      content = lines(g)
      break
    case 'grid':
      content = grid(g)
      break
    case 'wave':
      content = wave(g)
      break
    case 'ring':
      content = ring(g)
      break
    case 'roundOutline':
      content = roundedBars(g, true)
      break
    case 'roundSolid':
      content = roundedBars(g, false)
      break
    case 'bars':
    default:
      content = bars(g, false)
  }

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio={isRing ? 'xMidYMid meet' : 'none'}
      className="h-full w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={X0} y1="0" x2={X1} y2="0">
          <stop offset="0" stopColor="#6a74f2" />
          <stop offset="0.5" stopColor="#b06cf0" />
          <stop offset="1" stopColor="#ff8a6a" />
        </linearGradient>
      </defs>
      {content}
    </svg>
  )
}
