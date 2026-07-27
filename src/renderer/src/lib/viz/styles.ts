// The visualizer styles available in Prism's audio player, chosen from the
// exploration in docs/visualizer-lab. Each is a factory that allocates its own
// buffers and returns a draw function closing over them.

import {
  bandRanges,
  bandValue,
  clamp,
  makeBands,
  paletteAt,
  bandColor,
  rgba,
  shape,
  sweep,
  type AudioFrame,
  type VizOpts,
  type VizStyle,
  type VizTheme
} from './core'

/** Ring shaping, ported from the tuning Filesmith settled on.
 *
 *  Deliberately ABSOLUTE: a hard contrast curve over a log-ish bin spread, with
 *  a treble tilt and slow smoothing. Per-band adaptive gain (used by the bar
 *  styles) gives every band its own scale, which on a ring reads as an uneven,
 *  jittery outline; this keeps neighbouring rays related to each other, so the
 *  ring stays smooth and still collapses when the track drops away. */
function makeRingBands(half: number, normalize = 0.45, smoothPasses = 3): {
  vals: Float32Array
  update: (d: AudioFrame, o: VizOpts) => void
} {
  const CONTRAST = 2.1 // the raw curve; higher crushes quiet bands to nothing
  const TILT = 2.1
  const LEVEL = 2.1
  const RESPONSIVENESS = 0.1
  const REACTION = 0.1
  const vals = new Float32Array(half) // what the style draws: blurred
  const cur = new Float32Array(half) // per-band, before neighbours are mixed in
  const tmp = new Float32Array(half)
  const peaks = new Float32Array(half).fill(0.08)
  return {
    vals,
    update(d, o) {
      for (let m = 0; m < half; m++) {
        const frac = m / half
        const bin = 2 + Math.floor(Math.pow(frac, 1.5) * 430)
        const raw = d.freq[Math.min(d.freq.length - 1, bin)] / 255

        // Absolute: real dynamics, but leaves the quiet bands as stubs.
        const absolute = Math.pow(raw, CONTRAST) * (1 + frac * TILT) * LEVEL * RESPONSIVENESS
        // Normalised against each band's own recent peak: even all the way round,
        // but flat and lifeless on its own.
        peaks[m] = Math.max(raw, peaks[m] * 0.995)
        const norm = (raw / Math.max(peaks[m], 0.06)) * clamp(raw * 6, 0, 1) * 0.28

        const target = (absolute * (1 - normalize) + norm * normalize) * o.sensitivity
        cur[m] += (target - cur[m]) * REACTION
      }

      // Couple each ray to its neighbours: a 1-2-1 kernel, so when one band
      // spikes the rays beside it rise too, by progressively less. Without this
      // every ray moves alone and the ring reads as a field of loose spikes
      // rather than one connected surface.
      vals.set(cur)
      for (let p = 0; p < smoothPasses; p++) {
        for (let m = 0; m < half; m++) {
          const l = vals[m === 0 ? 0 : m - 1]
          const r = vals[m === half - 1 ? half - 1 : m + 1]
          tmp[m] = (l + vals[m] * 2 + r) * 0.25
        }
        vals.set(tmp)
      }
    }
  }
}

// One grounded hollow-bar setup shared by every Outline variation: log bands,
// a peak-hold per bar, and the geometry (bars flush to the bottom). Each variation
// supplies only how a single bar is drawn.
function outlineVariation(
  id: string,
  name: string,
  blurb: string,
  drawBar: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    bw: number,
    h: number,
    col: string | CanvasGradient,
    o: VizOpts
  ) => void,
  listed = true
): VizStyle {
  return {
    id,
    name,
    blurb,
    variant: listed,
    create() {
      const n = 30
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        // Lower approach rate than the default: the bars glide a little more and
        // read as less twitchy, without going sluggish.
        b.update(d, o, 0.13)
        const slot = W / n
        const bw = slot * 0.7
        const base = H // flush with the transport
        const maxH = H * 0.88
        const minH = maxH * 0.035 // always a small stub, never fully gone
        ctx.lineWidth = Math.max(1, 1.4 * o.dpr)
        ctx.lineCap = 'butt'
        for (let i = 0; i < n; i++) {
          const v = clamp(b.values[i], 0, 1)
          const h = minH + v * (maxH - minH)
          const x = i * slot + (slot - bw) / 2
          const y = base - h
          let col: string | CanvasGradient
          if (o.cycle) {
            // Whole spectrum, rotating over time; each bar offset along the wheel.
            let hue = (d.t * o.cycle + (i / n) * 320) % 360
            if (hue < 0) hue += 360
            col = `hsl(${hue}, 85%, 62%)`
          } else if (o.vgrad) {
            // Each bar carries the full top->bottom gradient over its own height.
            const g = ctx.createLinearGradient(0, y, 0, base)
            g.addColorStop(0, o.vgrad[0])
            g.addColorStop(1, o.vgrad[1])
            col = g
          } else {
            col = paletteAt(o.palette, i / (n - 1))
          }
          drawBar(ctx, x, y, bw, h, col, o)
        }
      }
    }
  }
}

// ------------------------------------------------------------- colour themes
// The same clean bar shape (a rounded-top solid bar) rendered with different
// palettes and finishes, so the browseable list is a colour picker. The bar
// shape itself is settled and lives on the presets.

const P_BRAND = ['#5b5bd6', '#9a6cff', '#ff9a8b']
const P_NEON = ['#18e0ff', '#8a5cff', '#ff3df0']
const P_SPECTRUM = ['#8a5cff', '#ff6ac1', '#ffd36a', '#5cffd0', '#5c9cff']
const P_GOLD = ['#fff3a0', '#ffd24a', '#ff9e2c']
const P_ICE = ['#eafcff', '#8fd6ff', '#3f6dff']

// ---- Drop-burst variants -------------------------------------------------
//
// The Halo ring fires one of these when a drop lands (see the `ripples` style).
// A burst is just {kind, age}; age runs 0->1 (past 1 for the staggered ones) at
// the per-kind speed below, and the draw switch turns age into the visual. The
// numbers here are what the gear panel's 1-10 row selects.

export const DROP_VARIANTS = 11
export const DEFAULT_DROP_STYLE = 1
// The combo variant: the shockwave (1) on beats/drops PLUS a continuous
// bass-reactive centre bloom - handled specially in the ripples style.
export const COMBO_DROP_STYLE = 11

// How fast each variant advances (per frame). All live one unit (age 0->1).
// 1 shockwave, 2 fill, 3 core bloom, 4 nova, 5 implosion, 6 halo, 7 sweep,
// 8 pulse, 9 starburst, 10 ignite.
const DROP_SPEED: Record<number, number> = {
  1: 0.02, 2: 0.03, 3: 0.026, 4: 0.035, 5: 0.022,
  6: 0.03, 7: 0.02, 8: 0.045, 9: 0.03, 10: 0.045
}
const DROP_MAXAGE: Record<number, number> = {}

const easeOutQuart = (x: number): number => 1 - Math.pow(1 - x, 4)
const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3)
// A short, punchy attack that eases off: fast rise, gentle settle. The
// brightness envelope of a hit - spikes early in the life, then decays.
const strike = (x: number): number => {
  const up = clamp(x / 0.14, 0, 1)
  const down = 1 - clamp((x - 0.14) / 0.86, 0, 1)
  return up * up * (down * down)
}

/** A soft, luminous ring: a wide feathered halo with a hot core line, both drawn
 *  additively so overlapping light accumulates toward white at the centre. The
 *  building block that makes the ring variants read as energy, not a stroked
 *  circle. Assumes the caller has set an additive composite. */
function glowRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  band: number,
  col: string,
  alpha: number
): void {
  if (r <= 0.5 || alpha <= 0.001) return
  const inner = Math.max(0, r - band)
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, r + band)
  grad.addColorStop(0, rgba(col, 0))
  grad.addColorStop(0.5, rgba(col, alpha * 0.55))
  grad.addColorStop(1, rgba(col, 0))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, r + band, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = rgba(col, alpha)
  ctx.lineWidth = Math.max(1, band * 0.5)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
}

/** Draw one drop burst. cx/cy is the centre, R the inner-ring radius, minD the
 *  frame's short side. `age` is 0->1 (or beyond for kind 8). `p` is the power:
 *  ~0.5 for the per-beat pulse, 1 for a full drop.
 *
 *  Everything is drawn additively with feathered gradient edges and a struck
 *  brightness envelope, so a burst reads as a pulse of light blooming and fading
 *  rather than a hard shape switching on and off. */
function drawDropBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  minD: number,
  R: number,
  o: VizOpts,
  kind: number,
  age: number,
  p: number
): void {
  const a = clamp(age, 0, 1)
  const col = o.accent
  const sz = 0.55 + 0.45 * p // how far the outward variants travel
  const g = strike(a) // brightness envelope: quick attack, smooth decay
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const TAU = Math.PI * 2
  switch (kind) {
    case 1: {
      // Shockwave: a crisp ring races out from the halo rim (not the centre),
      // thinning and fading as it goes.
      const e = easeOutQuart(a)
      const r = R + e * minD * 0.9 * sz
      const fade = 1 - a
      ctx.strokeStyle = rgba(col, fade * 0.9 * p)
      ctx.lineWidth = Math.max(1, minD * 0.02 * fade)
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, TAU)
      ctx.stroke()
      break
    }
    case 2: {
      // Fill: a solid disc floods out from the centre to the ring, then fades.
      const rad = R * easeOutQuart(clamp(a * 1.5, 0, 1))
      const edge = minD * 0.02
      const grad = ctx.createRadialGradient(cx, cy, Math.max(0, rad - edge), cx, cy, rad + edge)
      const al = (1 - a) * 0.6 * p
      grad.addColorStop(0, rgba(col, al))
      grad.addColorStop(0.7, rgba(col, al))
      grad.addColorStop(1, rgba(col, 0))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, rad + edge, 0, TAU)
      ctx.fill()
      break
    }
    case 3: {
      // Core bloom: a hot orb ignites at the centre and swells to a soft glow.
      const rad = R * (0.2 + easeOutCubic(a) * 1.15)
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, rad))
      const al = g * 0.95 * p
      grad.addColorStop(0, rgba(col, al))
      grad.addColorStop(0.35, rgba(col, al * 0.55))
      grad.addColorStop(0.75, rgba(col, al * 0.18))
      grad.addColorStop(1, rgba(col, 0))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(1, rad), 0, TAU)
      ctx.fill()
      break
    }
    case 4: {
      // Nova: tapered beams lance out radially past the rays and draw back.
      const N = 32
      const reach = R + minD * 0.36 * sz * Math.sin(easeOutCubic(a) * Math.PI)
      ctx.lineWidth = Math.max(1, minD * 0.007)
      for (let k = 0; k < N; k++) {
        const ang = (k / N) * TAU
        const ca = Math.cos(ang)
        const sa = Math.sin(ang)
        const x0 = cx + ca * R
        const y0 = cy + sa * R
        const x1 = cx + ca * reach
        const y1 = cy + sa * reach
        const lg = ctx.createLinearGradient(x0, y0, x1, y1)
        lg.addColorStop(0, rgba(col, (1 - a) * 0.85 * p))
        lg.addColorStop(1, rgba(col, 0))
        ctx.strokeStyle = lg
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
        ctx.stroke()
      }
      break
    }
    case 5: {
      // Implosion: a ring rushes inward and detonates at the centre.
      if (a < 0.72) {
        const e = easeOutCubic(a / 0.72)
        const r = minD * 0.62 * (1 - e)
        glowRing(ctx, cx, cy, r, minD * (0.015 + 0.02 * e), col, (0.3 + 0.7 * e) * 0.95 * p)
      } else {
        const b = (a - 0.72) / 0.28
        const rad = R * (0.3 + b * 1.1)
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, rad))
        const al = (1 - b) * 0.95 * p
        grad.addColorStop(0, rgba(col, al))
        grad.addColorStop(0.5, rgba(col, al * 0.4))
        grad.addColorStop(1, rgba(col, 0))
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(cx, cy, Math.max(1, rad), 0, TAU)
        ctx.fill()
      }
      break
    }
    case 6: {
      // Halo: the ring itself flares - a bright soft aura pulses in place on the
      // rim and fades, without travelling.
      glowRing(ctx, cx, cy, R * 1.04, minD * (0.015 + 0.02 * g), col, g * 0.95 * p)
      break
    }
    case 7: {
      // Sweep: a bright comet-arc races once around the ring and trails off.
      const head = a * TAU * 1.05
      const tail = Math.PI * 0.6
      const segs = 26
      ctx.lineWidth = Math.max(1, minD * 0.02)
      for (let s = 0; s < segs; s++) {
        const f = s / segs
        const a0 = head - f * tail
        ctx.strokeStyle = rgba(col, (1 - f) * (1 - f) * (1 - a) * 0.95 * p)
        ctx.beginPath()
        ctx.arc(cx, cy, R, a0 - tail / segs - 0.01, a0)
        ctx.stroke()
      }
      break
    }
    case 8: {
      // Pulse: a bright core disc throbs once at the centre - a heartbeat.
      const rad = R * (0.16 + g * 0.5)
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, rad))
      const al = g * 0.95 * p
      grad.addColorStop(0, rgba(col, al))
      grad.addColorStop(0.6, rgba(col, al * 0.4))
      grad.addColorStop(1, rgba(col, 0))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(1, rad), 0, TAU)
      ctx.fill()
      break
    }
    case 9: {
      // Starburst: sharp tapered blades stab out radially and retract.
      const N = 12
      const len = minD * 0.32 * sz * Math.sin(easeOutCubic(a) * Math.PI)
      const wide = minD * 0.022 * (1 - a * 0.4)
      for (let k = 0; k < N; k++) {
        const ang = (k / N) * TAU
        const ca = Math.cos(ang)
        const sa = Math.sin(ang)
        const px = -sa
        const py = ca
        const tipX = cx + ca * (R + len)
        const tipY = cy + sa * (R + len)
        const baseX = cx + ca * R
        const baseY = cy + sa * R
        const lg = ctx.createLinearGradient(baseX, baseY, tipX, tipY)
        lg.addColorStop(0, rgba(col, (1 - a * 0.5) * 0.9 * p))
        lg.addColorStop(1, rgba(col, 0))
        ctx.fillStyle = lg
        ctx.beginPath()
        ctx.moveTo(tipX, tipY)
        ctx.lineTo(baseX + px * wide, baseY + py * wide)
        ctx.lineTo(baseX - px * wide, baseY - py * wide)
        ctx.closePath()
        ctx.fill()
      }
      break
    }
    case 10: {
      // Ignite: the ring discharges - a bright band flares just past the rim and
      // fades fast, a short sharp burst rather than a travelling wave.
      const e = easeOutQuart(a)
      const r = R * (1.0 + e * 0.4 * sz)
      glowRing(ctx, cx, cy, r, minD * 0.03 * (1 - a * 0.5), col, (1 - a) * (1 - a) * 0.95 * p)
      break
    }
  }
  ctx.restore()
}



export const VIZ_STYLES: VizStyle[] = [














  /* ---------------------------------------------------------------- bar shapes */
  outlineVariation('outline-bars', 'Outline', 'Hollow rectangular bars.', (ctx, x, y, bw, h, col) => {
    ctx.strokeStyle = col
    ctx.strokeRect(x, y, bw, h)
  }),

  outlineVariation('outline-round', 'Rounded', 'Hollow bars softened to rounded capsules.', (ctx, x, y, bw, h, col) => {
    const r = Math.min(bw / 2, h / 2)
    ctx.strokeStyle = col
    ctx.beginPath()
    ctx.roundRect(x, y, bw, h, r)
    ctx.stroke()
  }),

  outlineVariation('solid-bars', 'Solid', 'Plain solid bars.', (ctx, x, y, bw, h, col) => {
    ctx.fillStyle = col
    ctx.fillRect(x, y, bw, h)
  }),

  outlineVariation('solid-round', 'Solid Round', 'Solid bars with rounded tops.', (ctx, x, y, bw, h, col) => {
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.roundRect(x, y, bw, h, [bw / 2, bw / 2, 0, 0])
    ctx.fill()
  }),

  outlineVariation('segments', 'Segments', 'Bars built from stacked LED blocks.', (ctx, x, y, bw, h, col, o) => {
    const cell = Math.max(4 * o.dpr, bw * 0.7)
    const gap = cell * 0.28
    ctx.fillStyle = col
    for (let sy = y + h - cell; sy > y - 1; sy -= cell) {
      ctx.beginPath()
      ctx.roundRect(x, sy + gap / 2, bw, cell - gap, Math.min(bw, cell) * 0.18)
      ctx.fill()
    }
  }),


  /* ------------------------------------------- mirrored, centred on the glass */


  {
    id: 'mirror-caps',
    name: 'Mirror Caps',
    blurb: 'Peak caps hovering above and below the centre.',
    create() {
      const n = 44
      const b = makeBands(n)
      const peak = new Float32Array(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const mid = H / 2
        const slot = W / n
        const bw = slot * 0.72
        const reach = H * 0.42
        for (let i = 0; i < n; i++) {
          const v = clamp(b.values[i], 0, 1)
          // Fall fast enough to actually reach the centre line between hits.
          peak[i] = Math.max(peak[i] - 0.022, v)
          const off = Math.max(o.dpr, peak[i] * reach)
          const x = i * slot + (slot - bw) / 2
          const col = bandColor(o, i / (n - 1), d.t)
          ctx.fillStyle = col
          ctx.beginPath()
          ctx.roundRect(x, mid - off, bw, 3 * o.dpr, 1.5 * o.dpr)
          ctx.fill()
          ctx.beginPath()
          ctx.roundRect(x, mid + off - 3 * o.dpr, bw, 3 * o.dpr, 1.5 * o.dpr)
          ctx.fill()
          ctx.fillStyle = bandColor(o, i / (n - 1), d.t, 0.12)
          ctx.fillRect(x, mid - off, bw, off * 2)
        }
      }
    }
  },

  {
    id: 'mirror-outline',
    name: 'Mirror Outline',
    blurb: 'Hollow bars opening out from the centre in both directions.',
    create() {
      const n = 30
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const mid = H / 2
        const slot = W / n
        const bw = slot * 0.7
        const reach = H * 0.42
        ctx.lineWidth = Math.max(1, 1.4 * o.dpr)
        for (let i = 0; i < n; i++) {
          const v = clamp(b.values[i], 0, 1)
          const h = Math.max(2 * o.dpr, v * reach)
          const x = i * slot + (slot - bw) / 2
          ctx.strokeStyle = bandColor(o, i / (n - 1), d.t)
          ctx.strokeRect(x, mid - h, bw, h * 2)
        }
        ctx.fillStyle = 'rgba(255,255,255,0.07)'
        ctx.fillRect(0, mid - o.dpr / 2, W, o.dpr)
      }
    }
  },


  {
    id: 'chrome-bars',
    name: 'Chrome Bars',
    blurb: 'Bars on glass, mirrored about the centre with a polished falloff.',
    create() {
      const n = 48
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const mid = H / 2
        const slot = W / n
        const bw = slot * 0.6
        const reach = H * 0.42
        for (let i = 0; i < n; i++) {
          const v = clamp(b.values[i], 0, 1)
          const h = Math.max(o.dpr, v * reach)
          const x = i * slot + (slot - bw) / 2
          const t = i / (n - 1)
          ctx.fillStyle = bandColor(o, t, d.t)
          ctx.beginPath()
          ctx.roundRect(x, mid - h, bw, h, [bw / 2, bw / 2, 0, 0])
          ctx.fill()
          const g = ctx.createLinearGradient(0, mid, 0, mid + h)
          g.addColorStop(0, bandColor(o, t, d.t, 0.5))
          g.addColorStop(0.4, bandColor(o, t, d.t, 0.14))
          g.addColorStop(1, bandColor(o, t, d.t, 0))
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.roundRect(x, mid, bw, h, [0, 0, bw / 2, bw / 2])
          ctx.fill()
        }
        ctx.fillStyle = sweep(ctx, 0, 0, W, 0, o.palette, 0.6)
        ctx.fillRect(0, mid - o.dpr / 2, W, Math.max(1, o.dpr))
      }
    }
  },

  {
    id: 'needles',
    name: 'Needles',
    blurb: 'Fine mirrored needles, dense across the full width.',
    create() {
      const n = 150
      const b = makeBands(n, 16000)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const mid = H / 2
        ctx.lineCap = 'round'
        ctx.lineWidth = Math.max(1, o.dpr * 1.4)
        for (let i = 0; i < n; i++) {
          const v = clamp(b.values[i], 0, 1)
          const h = Math.max(o.dpr, v * H * 0.42)
          const x = ((i + 0.5) / n) * W
          ctx.strokeStyle = bandColor(o, i / (n - 1), d.t, 0.35 + v * 0.65)
          ctx.beginPath()
          ctx.moveTo(x, mid - h)
          ctx.lineTo(x, mid + h)
          ctx.stroke()
        }
      }
    }
  },

  /* ------------------------------------------------------------------ wave */
  {
    id: 'liquid',
    name: 'Liquid Wave',
    blurb: 'A smooth filled band that swells with the mix.',
    create() {
      const n = 56
      const ranges = bandRanges(n, 30, 16000)
      const v = new Float32Array(n)
      return (ctx, W, H, d, o) => {
        const mid = H / 2
        for (let i = 0; i < n; i++) {
          v[i] += (shape(bandValue(d.freq, ranges[i]), i, n, o) - v[i]) * 0.18
        }
        let a = v
        for (let pass = 0; pass < 3; pass++) {
          const b2 = new Float32Array(n)
          for (let i = 0; i < n; i++) {
            b2[i] = (a[Math.max(0, i - 1)] + a[i] * 2 + a[Math.min(n - 1, i + 1)]) / 4
          }
          a = b2
        }
        // Bleed the ends past both edges so the band runs off-frame instead of
        // stopping short, and floor the height so the quiet end stays a visible
        // band rather than tapering to a thread.
        const over = W * 0.06
        const xAt = (i: number): number => -over + (i / (n - 1)) * (W + 2 * over)
        const hAt = (i: number): number => Math.max(0.06, a[i]) * H * 0.3

        ctx.beginPath()
        ctx.moveTo(xAt(0), mid - hAt(0))
        for (let i = 0; i < n - 1; i++) {
          const cx = (xAt(i) + xAt(i + 1)) / 2
          ctx.quadraticCurveTo(xAt(i), mid - hAt(i), cx, mid - (hAt(i) + hAt(i + 1)) / 2)
        }
        // explicit top-right, right edge, bottom-right corners, so nothing pinches
        ctx.lineTo(xAt(n - 1), mid - hAt(n - 1))
        ctx.lineTo(xAt(n - 1), mid + hAt(n - 1))
        for (let i = n - 1; i > 0; i--) {
          const cx = (xAt(i) + xAt(i - 1)) / 2
          ctx.quadraticCurveTo(xAt(i), mid + hAt(i), cx, mid + (hAt(i) + hAt(i - 1)) / 2)
        }
        ctx.lineTo(xAt(0), mid + hAt(0)) // close the bottom-left; the notch was here
        ctx.closePath()
        if (o.cycle) {
          const gg = ctx.createLinearGradient(0, 0, W, 0)
          for (let s = 0; s <= 6; s++) gg.addColorStop(s / 6, bandColor(o, s / 6, d.t, 0.85))
          ctx.fillStyle = gg
        } else {
          ctx.fillStyle = sweep(ctx, 0, 0, W, 0, o.palette, 0.85)
        }
        ctx.fill()
      }
    }
  },

  /* -------------------------------------------------------------- circular */
  {
    id: 'ripples',
    name: 'Bass Ripples',
    blurb: 'Rings fire on every kick and spread through a spectrum halo.',
    create() {
      // Mirrored and shaped like the Filesmith ring. Unmirrored, bass and treble
      // sit on opposite sides and the outline reads lopsided; with per-band
      // adaptive gain each ray moves on its own scale, which reads as a jagged,
      // restless edge. Both are fixed here.
      const HALF = 104 // 208 rays once mirrored
      // Evened out in amplitude, and neighbour-coupled so the outline flows.
      // Slightly less coupling than before (3 passes), so individual bars keep a
      // touch more of their own movement instead of fully melting together.
      const bands = makeRingBands(HALF, 0.55, 3)
      // The selected variant IS the ring's pulse: a modest burst fires on every
      // beat ("all spots"), and a full-power one on a drop. `power` scales each.
      const bursts: Array<{ kind: number; age: number; power: number }> = []
      let dropArmed = true // rearms between drops so one drop fires one ring
      let flash = 0 // decaying core flare, spikes on a drop
      let bassBloom = 0 // combo variant: bass-reactive centre glow
      let bassRef = 0 // slow sub-bass baseline for the kick detector (all variants)
      let lastPreview: number | undefined // fire a burst whenever this nonce changes
      return (ctx, W, H, d, o) => {
        const cx = W / 2
        const cy = H / 2
        // Sized to fill the frame. Anything much smaller reads as a spinner.
        const minD = Math.min(W, H)
        const R = minD * 0.25
        const selected = o.dropStyle ?? DEFAULT_DROP_STYLE
        // The combo variant pairs the shockwave (fired as discrete bursts, kind 1)
        // with a continuous bass-reactive centre bloom drawn below.
        const combo = selected === COMBO_DROP_STYLE
        const kind = combo ? 1 : selected

        // Kick detector: a sharp rise in sub-bass (~40-95 Hz, where the drum lives)
        // gated by an absolute presence floor. The ring fires on real drum hits
        // only - the old broad bass transient (d.beat) tripped on guitar strings
        // and filtered build-up noise, firing rings constantly. Sub-bass has almost
        // no guitar energy, and a build/sweep before a drop has no sub-bass either,
        // so this stays quiet through both.
        const binHz = d.sampleRate / 2048
        const slo = Math.max(1, Math.round(40 / binHz))
        const shi = Math.max(slo, Math.round(95 / binHz))
        let sub = 0
        for (let b = slo; b <= shi; b++) sub += d.freq[b]
        sub = sub / (shi - slo + 1) / 255
        bassRef += (sub - bassRef) * 0.04
        const rise = clamp((sub - bassRef) * 5, 0, 1)
        const present = clamp((sub - 0.62) / 0.25, 0, 1)
        const kick = rise * present

        // The ring fires on a drop, and only a drop. d.drop comes from the offline
        // analysis (analyzeDrops): playback crossing a pre-computed drop timestamp.
        // One ring per drop, rearmed once the pulse falls.
        if (d.drop > 0.5 && dropArmed) {
          bursts.push({ kind, age: 0, power: 1 })
          flash = 1
          dropArmed = false
        }
        if (d.drop < 0.2) dropArmed = true
        // Click-to-preview: when the nonce changes, fire one full-power burst of
        // the current variant so it can be seen on demand (even while paused).
        const preview = o.previewBurst ?? 0
        if (lastPreview === undefined) {
          lastPreview = preview
        } else if (preview !== lastPreview) {
          bursts.push({ kind, age: 0, power: 1 })
          flash = 1
          if (combo) bassBloom = 0.8 // show the bass bloom on preview too
          lastPreview = preview
        }
        flash *= 0.9
        if (bursts.length > 24) bursts.splice(0, bursts.length - 24)

        bands.update(d, o)

        // Combo: a centre bloom that thumps to the bass drum, driven by the same
        // sub-bass kick detector as the ring (above), so it too ignores guitar and
        // build-up noise. A slow attack / slow release smooths it into a gentle
        // thump; it swells on a bass drop. Drawn behind the rays so the ring sits
        // over it.
        if (combo) {
          bassBloom += (kick - bassBloom) * (kick > bassBloom ? 0.3 : 0.09)
          const raw = clamp(bassBloom + d.drop * 0.7, 0, 1)
          // Compress the register: a gamma curve lifts the small hits (less subtle
          // at the bottom) and the tighter size range caps the peak (a lot less
          // huge at the top), so min and max sit closer together.
          const amt = Math.pow(raw, 0.55)
          if (amt > 0.02) {
            const rad = R * (0.32 + amt * 0.4)
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
            const al = clamp(amt * 0.82, 0, 1)
            grad.addColorStop(0, rgba(o.accent, al))
            grad.addColorStop(0.4, rgba(o.accent, al * 0.5))
            grad.addColorStop(1, rgba(o.accent, 0))
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.arc(cx, cy, rad, 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()
          }
        }

        // Centre-area fills (fill / core bloom / pulse) render behind the rays so
        // the ring sits over them; the outward effects pop on top after the orb.
        for (const b of bursts) {
          if (b.kind === 2 || b.kind === 3 || b.kind === 8) {
            drawDropBurst(ctx, cx, cy, minD, R, o, b.kind, b.age, b.power)
          }
        }

        const tipMax = minD * 0.48
        const total = HALF * 2
        ctx.lineCap = 'round'
        ctx.lineWidth = 3 * o.dpr
        for (let j = 0; j < total; j++) {
          // Mirrored about the vertical, bass meeting at the bottom seam.
          const m = j < HALF ? j : total - 1 - j
          const a = Math.PI / 2 + ((j + 0.5) / total) * Math.PI * 2
          let tip = R + minD * bands.vals[m] * 0.55 // taller rays
          if (tip > tipMax) tip = tipMax
          const ca = Math.cos(a)
          const sa = Math.sin(a)
          ctx.strokeStyle = bandColor(o, m / (HALF - 1), d.t)
          ctx.beginPath()
          ctx.moveTo(cx + ca * R, cy + sa * R)
          ctx.lineTo(cx + ca * tip, cy + sa * tip)
          ctx.stroke()
        }

        // A living orb: the blob drifts on a slow lazy path and gently breathes,
        // and the highlight orbits inside it, so it reads like something present
        // and thinking rather than a static glow. Amplitudes are tiny on purpose.
        const t = d.t / 1000
        const driftX = (Math.sin(t * 0.31) + Math.sin(t * 0.17 + 1.3) * 0.6) * minD * 0.02
        const driftY = (Math.cos(t * 0.26) + Math.sin(t * 0.4 + 0.7) * 0.5) * minD * 0.018
        // Breathes with the beat and swells on a drop (flash).
        const breathe = 1 + Math.sin(t * 0.7) * 0.06 + d.beat * 0.16 + flash * 0.4
        const bx = cx + driftX
        const by = cy + driftY
        const core = R * 0.62 * breathe
        // the shine sits off-centre and slowly circles within the orb
        const sx = bx + Math.sin(t * 0.53) * core * 0.22
        const sy = by + Math.cos(t * 0.61) * core * 0.22
        const cg = ctx.createRadialGradient(sx, sy, 0, bx, by, core)
        cg.addColorStop(0, rgba(o.accent, clamp(0.55 + d.beat * 0.3 + flash * 0.4, 0, 1)))
        cg.addColorStop(0.45, rgba(o.accent, 0.16 + flash * 0.2))
        cg.addColorStop(1, rgba(o.accent, 0))
        ctx.beginPath()
        ctx.arc(bx, by, core, 0, Math.PI * 2)
        ctx.fillStyle = cg
        ctx.fill()

        // Foreground bursts (everything but the background flash/bloom) pop on
        // top of the ring, then every burst advances and old ones are culled.
        for (let i = bursts.length - 1; i >= 0; i--) {
          const b = bursts[i]
          if (b.kind !== 2 && b.kind !== 3 && b.kind !== 8) {
            drawDropBurst(ctx, cx, cy, minD, R, o, b.kind, b.age, b.power)
          }
          b.age += DROP_SPEED[b.kind] ?? 0.025
          if (b.age > (DROP_MAXAGE[b.kind] ?? 1)) bursts.splice(i, 1)
        }
      }
    }
  },



  /* ------------------------------------------------------------------ grid */




  {
    id: 'clean-wall',
    name: 'Clean Wall',
    blurb: 'The rack-mount wall with the unlit cells hidden. Nothing but the sound.',
    create() {
      const n = 64
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const rows = 26
        const cw = W / n
        const ch = H / rows
        for (let i = 0; i < n; i++) {
          const lit = clamp(b.values[i], 0, 1) * rows
          for (let j = 0; j < rows; j++) {
            const frac = clamp(lit - j, 0, 1)
            if (frac <= 0.02) continue // no dark grid left showing through
            ctx.fillStyle = bandColor(o, j / (rows - 1), d.t, 0.25 + frac * 0.75)
            ctx.fillRect(i * cw + cw * 0.18, H - (j + 1) * ch + ch * 0.18, cw * 0.64, ch * 0.64)
          }
        }
      }
    }
  }
]

export const DEFAULT_STYLE_ID = 'ripples'

export function styleById(id: string): VizStyle {
  return VIZ_STYLES.find((s) => s.id === id) ?? VIZ_STYLES[0]
}


// ------------------------------------------------------------------- themes
// Colour + finish, applied on top of whichever shape a preset selected. Swaps
// the palette and accent every style already reads, plus an optional global glow
// or opacity handled by the Visualizer, so one theme recolours every shape.
export const THEMES: VizTheme[] = [
  { id: 'brand', name: 'Brand', blurb: 'Indigo, violet and coral.', palette: P_BRAND, accent: '#7c74f0' },
  { id: 'neon', name: 'Neon', blurb: 'Electric cyan to magenta, glowing.', palette: P_NEON, accent: '#9a5cff', glow: 12 },
  { id: 'glow', name: 'Glow', blurb: 'Brand colours with a soft bloom.', palette: P_BRAND, accent: '#8a7cff', glow: 15 },
  { id: 'gradient', name: 'Gradient', blurb: 'A full spectrum sweep.', palette: P_SPECTRUM, accent: '#9a6cff' },
  { id: 'rainbow', name: 'Rainbow', blurb: 'Every hue across the bars.', palette: ['#ff4d6d', '#ff9e2c', '#ffe14a', '#5cffa8', '#39c2ff', '#8a5cff'], accent: '#39c2ff' },
  { id: 'gold', name: 'Gold', blurb: 'Warm yellow into amber.', palette: P_GOLD, accent: '#ffb42c' },
  { id: 'ice', name: 'Ice', blurb: 'Pale blue into deep sky.', palette: P_ICE, accent: '#5aa0ff' },
  { id: 'white', name: 'White', blurb: 'Clean monochrome white.', palette: ['#e9edf6', '#ffffff'], accent: '#ffffff' },

  // ---- rich gradients ----
  { id: 'fire', name: 'Fire', blurb: 'Yellow through orange into deep red.', palette: ['#ffe14a', '#ff8a1a', '#ff3535', '#c01418'], accent: '#ff6a1a', glow: 8 },
  { id: 'ocean', name: 'Ocean', blurb: 'Shallows to the deep blue.', palette: ['#9bf6ff', '#38aeff', '#3358d8'], accent: '#22a0ff' },
  { id: 'forest', name: 'Forest', blurb: 'Fresh leaf into pine.', palette: ['#c6ff9e', '#3ec46a', '#1c9a4e'], accent: '#3ec46a' },
  { id: 'toxic', name: 'Toxic', blurb: 'Acid yellow-green, glowing.', palette: ['#eaff6a', '#7dff2c', '#00c853'], accent: '#7dff2c', glow: 10 },
  { id: 'matrix', name: 'Matrix', blurb: 'Terminal green on black.', palette: ['#39ff14', '#00b30a'], accent: '#39ff14', glow: 10 },
  { id: 'aurora', name: 'Aurora', blurb: 'Northern-lights teal, blue and violet.', palette: ['#5cffd0', '#39c2ff', '#8a5cff', '#ff6ac1'], accent: '#5cffd0', glow: 8 },
  { id: 'nebula', name: 'Nebula', blurb: 'Deep violet, magenta and amber.', palette: ['#8b3ff0', '#db2777', '#f59e0b'], accent: '#db2777' },
  { id: 'ultraviolet', name: 'Ultraviolet', blurb: 'Lilac into deep purple.', palette: ['#e9d5ff', '#b56cff', '#8a3ff0'], accent: '#a855f7', glow: 8 },
  { id: 'miami', name: 'Miami', blurb: 'Hot cyan and pink.', palette: ['#00e5ff', '#c026d3', '#ff2fd0'], accent: '#ff2fd0', glow: 8 },
  { id: 'candy', name: 'Candy', blurb: 'Cotton-candy blue and pink.', palette: ['#a0e9ff', '#c0a0ff', '#ffa0e0'], accent: '#ff9ee6' },

  // ---- solid colours ----
  { id: 's-green', name: 'Green', blurb: 'Solid green.', palette: ['#22c55e'], accent: '#22c55e' },
  { id: 's-teal', name: 'Teal', blurb: 'Solid teal.', palette: ['#14b8a6'], accent: '#14b8a6' },
  { id: 's-cyan', name: 'Cyan', blurb: 'Solid cyan.', palette: ['#22d3ee'], accent: '#22d3ee' },
  { id: 's-sky', name: 'Sky', blurb: 'Solid sky blue.', palette: ['#38bdf8'], accent: '#38bdf8' },
  { id: 's-blue', name: 'Blue', blurb: 'Solid blue.', palette: ['#3b6dff'], accent: '#3b6dff' },
  { id: 's-indigo', name: 'Indigo', blurb: 'Solid indigo.', palette: ['#6366f1'], accent: '#6366f1' },
  { id: 's-violet', name: 'Violet', blurb: 'Solid violet.', palette: ['#8b5cf6'], accent: '#8b5cf6' },
  { id: 's-purple', name: 'Purple', blurb: 'Solid purple.', palette: ['#a855f7'], accent: '#a855f7' },
  { id: 's-magenta', name: 'Magenta', blurb: 'Solid magenta.', palette: ['#e83fd0'], accent: '#e83fd0' },
  { id: 's-pink', name: 'Pink', blurb: 'Solid hot pink.', palette: ['#ff5c9e'], accent: '#ff5c9e' },
  { id: 's-coral', name: 'Coral', blurb: 'Solid coral.', palette: ['#ff8a6a'], accent: '#ff8a6a' },
  { id: 's-crimson', name: 'Crimson', blurb: 'Solid crimson.', palette: ['#e01e4a'], accent: '#e01e4a' },

  // ---- vertical gradients: each bar fades top -> bottom, both directions ----
  { id: 'v-whiteblack', name: 'White → Black', blurb: 'White tips fading into the floor.', palette: ['#ffffff', '#2a2e3a'], accent: '#cfd4e0', vgrad: ['#ffffff', '#12141b'] },
  { id: 'v-blackwhite', name: 'Black → White', blurb: 'Dark tips over a bright base.', palette: ['#2a2e3a', '#ffffff'], accent: '#cfd4e0', vgrad: ['#3a3f4d', '#ffffff'] },
  { id: 'v-yellowred', name: 'Yellow → Red', blurb: 'Yellow tips over a red base.', palette: ['#ffe14a', '#ff2d2d'], accent: '#ff7a1a', vgrad: ['#ffe14a', '#ff2d2d'] },
  { id: 'v-redyellow', name: 'Red → Yellow', blurb: 'Red tips over a yellow base.', palette: ['#ff2d2d', '#ffe14a'], accent: '#ff7a1a', vgrad: ['#ff2d2d', '#ffe14a'] },
  { id: 'v-flame', name: 'Flame', blurb: 'White-hot tips down to deep red.', palette: ['#fff2b0', '#e01414'], accent: '#ff6a1a', vgrad: ['#fff2b0', '#c01212'] },
  { id: 'v-cyanblue', name: 'Cyan → Blue', blurb: 'Cyan tips over deep blue.', palette: ['#8ff4ff', '#2f5cff'], accent: '#38aeff', vgrad: ['#8ff4ff', '#2f5cff'] },
  { id: 'v-bluecyan', name: 'Blue → Cyan', blurb: 'Blue tips over cyan.', palette: ['#2f5cff', '#8ff4ff'], accent: '#38aeff', vgrad: ['#2f5cff', '#8ff4ff'] },
  { id: 'v-teallime', name: 'Teal → Lime', blurb: 'Teal tips into lime.', palette: ['#0e9e8a', '#c0ff7a'], accent: '#3ec46a', vgrad: ['#12b89a', '#c0ff7a'] },
  { id: 'v-pinkpurple', name: 'Pink → Purple', blurb: 'Pink tips fading to purple.', palette: ['#ff9ad8', '#7a3fe0'], accent: '#c05cff', vgrad: ['#ff9ad8', '#7a3fe0'] },
  { id: 'v-purplepink', name: 'Purple → Pink', blurb: 'Purple tips fading to pink.', palette: ['#7a3fe0', '#ff9ad8'], accent: '#c05cff', vgrad: ['#8a4ff0', '#ff9ad8'] },
  { id: 'v-orangemagenta', name: 'Orange → Magenta', blurb: 'Orange tips into magenta.', palette: ['#ff9e2c', '#e83fd0'], accent: '#ff6ac1', vgrad: ['#ff9e2c', '#e83fd0'] },
  { id: 'v-redpurple', name: 'Red → Purple', blurb: 'Red tips into purple.', palette: ['#ff4d6d', '#8a3ff0'], accent: '#c05cff', vgrad: ['#ff4d6d', '#8a3ff0'] },

  // ---- animated ----
  { id: 'cycle', name: 'Cycle', blurb: 'Every hue, drifting across the bars over time.', palette: ['#ff4d6d', '#ffd24a', '#5cff9e', '#39c2ff', '#8a5cff'], accent: '#39c2ff', cycle: 0.03 },
  { id: 'cycle-fast', name: 'Cycle Fast', blurb: 'The rainbow cycle, spun up.', palette: ['#ff4d6d', '#ffd24a', '#5cff9e', '#39c2ff', '#8a5cff'], accent: '#ff6ac1', cycle: 0.09 }
]

export const DEFAULT_THEME_ID = 'glow'

export function themeById(id: string): VizTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
