// Shared types and DSP helpers for the audio visualizers.
//
// A style is a factory: create(W, H) allocates whatever buffers it needs and
// returns the per-frame draw function, which closes over that state. That keeps
// every style's state privately typed instead of sharing an untyped bag.

export interface AudioFrame {
  /** Frequency magnitudes, 0-255. */
  freq: Uint8Array
  /** Time-domain samples; 128 is silence. */
  time: Uint8Array
  bass: number
  mid: number
  treble: number
  /** Overall RMS, 0-1. */
  level: number
  /** Decaying transient pulse; spikes on kicks. */
  beat: number
  /** Decaying drop pulse; spikes once when the mix breaks down then slams back
   *  to full (the classic drop), not on every kick. */
  drop: number
  /** Milliseconds since start. */
  t: number
  playing: boolean
  sampleRate: number
}

export interface VizOpts {
  accent: string
  palette: string[]
  sensitivity: number
  dpr: number
  /** When set, bar shapes fill each bar with a vertical top->bottom gradient
   *  ([topColor, bottomColor]) instead of a flat palette colour. */
  vgrad?: [string, string] | null
  /** Effect toggles (combine freely): `cycle` rotates the whole palette's hue over
   *  time; `move` scrolls the palette across the visual over time. */
  cycle?: boolean
  move?: boolean
  /** Which drop-burst variant the Halo ring fires on a drop (1-10). */
  dropStyle?: number
  /** A monotonically increasing nonce; when it changes, the ring fires one
   *  full-power preview burst of the current variant (for click-to-preview). */
  previewBurst?: number
}

/** A colour theme, applied on top of any style. The style provides the shape;
 *  the theme provides the palette and finish (glow / transparency). */
export interface VizTheme {
  id: string
  name: string
  blurb: string
  palette: string[]
  accent: string
  /** Outer-glow blur in px (scaled by dpr) applied to the whole visual. */
  glow?: number
  /** Overall opacity, for the translucent looks. */
  alpha?: number
  /** Vertical per-bar gradient [top, bottom]; overrides the flat palette on bars. */
  vgrad?: [string, string]
}

export type DrawFn = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  d: AudioFrame,
  o: VizOpts
) => void

export interface VizStyle {
  id: string
  name: string
  blurb: string
  /** Fade the canvas instead of clearing it, for motion trails. */
  trails?: boolean
  /** Reserved: where a shape rests inside its box. Removed for now - see the
   *  note in AudioView about position meaning different things per shape. */
  /** Shown in the browseable style list. Styles used only by a saved preset
   *  (the settled looks) stay renderable but out of the list. */
  variant?: boolean
  create(W: number, H: number): DrawFn
}

export const BRAND_PALETTE = ['#5b5bd6', '#9a6cff', '#ff9a8b']

const BINS = 1024 // analyser.frequencyBinCount at fftSize 2048
const NYQUIST = 22050

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Log-spaced bin ranges. Music energy bunches at the bottom, so linear bins
 *  leave the top of the spectrum permanently dead. */
export function bandRanges(count: number, fMin = 30, fMax = 12000): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < count; i++) {
    const f0 = fMin * Math.pow(fMax / fMin, i / count)
    const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / count)
    const b0 = Math.floor((f0 / NYQUIST) * BINS)
    let b1 = Math.ceil((f1 / NYQUIST) * BINS)
    if (b1 <= b0) b1 = b0 + 1
    out.push([Math.min(b0, BINS - 1), Math.min(b1, BINS)])
  }
  return out
}

/** Average+peak blend for one band: average alone reads mushy, peak alone jitters. */
export function bandValue(freq: Uint8Array, range: [number, number]): number {
  const [b0, b1] = range
  let sum = 0
  let max = 0
  for (let b = b0; b < b1; b++) {
    const v = freq[b]
    sum += v
    if (v > max) max = v
  }
  return ((sum / (b1 - b0)) * 0.6 + max * 0.4) / 255
}

/** Perceptual shaping, calibrated so a loud mix lands near 0.7 and only real
 *  peaks approach 1.0. Overdriving this pins every bar at full height, which
 *  reads as frantic rather than responsive. */
export function shape(v: number, i: number, n: number, o: VizOpts): number {
  const tilt = 1 + (i / Math.max(1, n)) * 0.7
  return Math.pow(v, 1.85) * tilt * o.sensitivity * 0.45
}

/** Per-band adaptive gain: each band is scaled against its own slowly decaying
 *  peak. Treble sits roughly ten times under bass, so absolute scaling leaves
 *  the high bands flat. The gate keeps real silence quiet. */
export function adaptive(peaks: Float32Array, i: number, v: number, o: VizOpts): number {
  peaks[i] = Math.max(v, peaks[i] * 0.993)
  const rel = v / Math.max(peaks[i], 0.045)
  const gate = clamp(v * 7, 0, 1)
  return clamp(rel * gate, 0, 1.05) * o.sensitivity * 0.82
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Sample a palette at t (0-1). Single-colour palettes (the solid themes) just
 *  return that colour; anything else would index pal[-1] and throw, which is
 *  what made every solid theme render nothing. */
export function paletteAt(pal: string[], t: number, alpha?: number): string {
  const segs = pal.length - 1
  if (segs <= 0) {
    const [r, g, b] = hexToRgb(pal[0])
    return alpha == null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`
  }
  const x = clamp(t, 0, 1) * segs
  const i = Math.min(segs - 1, Math.floor(x))
  const f = x - i
  const a = hexToRgb(pal[i])
  const b = hexToRgb(pal[i + 1])
  const r = Math.round(a[0] + (b[0] - a[0]) * f)
  const g = Math.round(a[1] + (b[1] - a[1]) * f)
  const bl = Math.round(a[2] + (b[2] - a[2]) * f)
  return alpha == null ? `rgb(${r},${g},${bl})` : `rgba(${r},${g},${bl},${alpha})`
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

function lerpRgb(a: [number, number, number], b: [number, number, number], f: number): [number, number, number] {
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)]
}

/** RGB at palette position `t` (0..1), clamped. */
function paletteRgb(pal: string[], t: number): [number, number, number] {
  const segs = pal.length - 1
  if (segs <= 0) return hexToRgb(pal[0])
  const x = clamp(t, 0, 1) * segs
  const i = Math.min(segs - 1, Math.floor(x))
  return lerpRgb(hexToRgb(pal[i]), hexToRgb(pal[i + 1]), x - i)
}

/** RGB at palette position `pos`, wrapping (…last→first→…) so it can scroll seamlessly. */
function paletteRgbCyclic(pal: string[], pos: number): [number, number, number] {
  const seg = pal.length
  if (seg <= 1) return hexToRgb(pal[0])
  let p = pos % 1
  if (p < 0) p += 1
  const x = p * seg
  const i = Math.floor(x) % seg
  return lerpRgb(hexToRgb(pal[i]), hexToRgb(pal[(i + 1) % seg]), x - Math.floor(x))
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return [Math.round((rgb[0] + m) * 255), Math.round((rgb[1] + m) * 255), Math.round((rgb[2] + m) * 255)]
}

const MOVE_SPEED = 0.00011 // palette-fractions per ms (spatial scroll)
const CYCLE_SPEED = 0.03 // hue-degrees per ms (hue rotation)

/** Colour for a band at position `frac` (0..1), `t` = frame time in ms. Applies the
 *  active colour EFFECTS: `move` scrolls the palette, `cycle` rotates its hue.
 *  With no effects it's just the palette. Every style colours through this, so the
 *  effects work on all of them. */
export function bandColor(o: VizOpts, frac: number, t: number, alpha?: number): string {
  let rgb = o.move ? paletteRgbCyclic(o.palette, frac + t * MOVE_SPEED) : paletteRgb(o.palette, frac)
  if (o.cycle) {
    const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2])
    rgb = hslToRgb(h + t * CYCLE_SPEED, s, l)
  }
  return alpha == null ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`
}

/** A gradient sweeping the palette along an axis. */
export function sweep(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pal: string[],
  alpha?: number
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  g.addColorStop(0, paletteAt(pal, 0, alpha))
  g.addColorStop(0.5, paletteAt(pal, 0.5, alpha))
  g.addColorStop(1, paletteAt(pal, 1, alpha))
  return g
}

/** Standard per-band tracker used by most styles: log ranges, adaptive gain and
 *  temporal smoothing, wrapped so a style needs one call per frame. */
export function makeBands(
  n: number,
  fMax = 12000
): { values: Float32Array; update: (d: AudioFrame, o: VizOpts, rate?: number) => void } {
  const ranges = bandRanges(n, 30, fMax)
  const values = new Float32Array(n)
  const peaks = new Float32Array(n).fill(0.09)
  return {
    values,
    update(d, o, rate = 0.18) {
      // Mostly absolute: loud bands reach full height and quiet ones stay short,
      // so the field is not permanently filled and a loud hit really peaks. A
      // treble tilt keeps the highs readable, and only a light adaptive touch
      // (far less normalisation than the ring) stops the very top bands vanishing.
      // Temporal smoothing (rate) still glides everything; loudness collapses it.
      const dyn = clamp(d.level / 0.09, 0, 1)
      for (let i = 0; i < n; i++) {
        const frac = i / n
        const raw = bandValue(d.freq, ranges[i])
        const abs = Math.pow(raw, 1.55) * (1 + frac * 1.3) * o.sensitivity * 1.18
        const norm = adaptive(peaks, i, raw, o)
        const target = clamp(abs * 0.85 + norm * 0.15, 0, 1.35) * dyn
        values[i] += (target - values[i]) * rate
      }
    }
  }
}

/** Same, but using absolute perceptual shaping rather than per-band gain. Better
 *  when you want an honest spectrum shape (loud bass really is bigger). */
export function makeShapedBands(
  n: number,
  fMax = 16000
): { values: Float32Array; update: (d: AudioFrame, o: VizOpts, rate?: number) => void } {
  const ranges = bandRanges(n, 30, fMax)
  const values = new Float32Array(n)
  return {
    values,
    update(d, o, rate = 0.18) {
      for (let i = 0; i < n; i++) {
        const target = shape(bandValue(d.freq, ranges[i]), i, n, o)
        values[i] += (target - values[i]) * rate
      }
    }
  }
}
