// The visualizer styles available in Prism's audio player, chosen from the
// exploration in docs/visualizer-lab. Each is a factory that allocates its own
// buffers and returns a draw function closing over them.

import {
  bandRanges,
  bandValue,
  clamp,
  makeBands,
  makeShapedBands,
  paletteAt,
  rgba,
  shape,
  sweep,
  adaptive,
  type VizStyle
} from './core'

export const VIZ_STYLES: VizStyle[] = [
  /* ------------------------------------------------------------------ bars */
  {
    id: 'wave-bars',
    name: 'Wave Bars',
    blurb: 'Mirrored bars around a center line.',
    create() {
      const n = 96
      const b = makeShapedBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const mid = H / 2
        const slot = W / n
        const bw = Math.max(2 * o.dpr, slot * 0.62)
        ctx.fillStyle = 'rgba(255,255,255,0.06)'
        ctx.fillRect(0, mid - o.dpr / 2, W, o.dpr)
        for (let i = 0; i < n; i++) {
          const half = Math.max(0.018, b.values[i]) * (H * 0.34)
          const x = i * slot + (slot - bw) / 2
          ctx.fillStyle = paletteAt(o.palette, i / (n - 1))
          ctx.beginPath()
          ctx.roundRect(x, mid - half, bw, half * 2, bw / 2)
          ctx.fill()
        }
      }
    }
  },

  {
    id: 'twin-bars',
    name: 'Twin Bars',
    blurb: 'Bars on polished chrome, reflection falling away beneath.',
    create() {
      const n = 44
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const slot = W / n
        const bw = slot * 0.62
        const floorY = H * 0.54
        const maxH = floorY * 0.92
        const reflectMax = H - floorY

        const sheen = ctx.createLinearGradient(0, floorY, 0, H)
        sheen.addColorStop(0, 'rgba(255,255,255,0.10)')
        sheen.addColorStop(0.35, 'rgba(255,255,255,0.02)')
        sheen.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = sheen
        ctx.fillRect(0, floorY, W, H - floorY)

        for (let i = 0; i < n; i++) {
          const v = clamp(b.values[i], 0, 1)
          const h = Math.max(o.dpr, v * maxH)
          const x = i * slot + (slot - bw) / 2
          const t = i / (n - 1)

          ctx.fillStyle = paletteAt(o.palette, t)
          ctx.beginPath()
          ctx.roundRect(x, floorY - h, bw, h, [bw / 2, bw / 2, 0, 0])
          ctx.fill()

          // The falloff is what makes this read as a mirror; a flat translucent
          // copy just looks like a second bar.
          const rh = Math.min(h, reflectMax)
          if (rh > 1) {
            const g = ctx.createLinearGradient(0, floorY, 0, floorY + rh)
            g.addColorStop(0, paletteAt(o.palette, t, 0.5))
            g.addColorStop(0.4, paletteAt(o.palette, t, 0.14))
            g.addColorStop(1, paletteAt(o.palette, t, 0))
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.roundRect(x, floorY, bw, rh, [0, 0, bw / 2, bw / 2])
            ctx.fill()
          }
        }

        ctx.fillStyle = sweep(ctx, 0, 0, W, 0, o.palette, 0.6)
        ctx.fillRect(0, floorY - o.dpr / 2, W, Math.max(1, o.dpr))
      }
    }
  },

  {
    id: 'floating-caps',
    name: 'Floating Caps',
    blurb: 'Only the peak caps, hovering with no bar beneath.',
    create() {
      const n = 40
      const b = makeBands(n)
      const peak = new Float32Array(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const slot = W / n
        const bw = slot * 0.72
        const base = H // flush with the transport, no gap beneath
        const maxH = H * 0.86
        for (let i = 0; i < n; i++) {
          const v = clamp(b.values[i], 0, 1)
          peak[i] = Math.max(peak[i] - 0.006, v)
          const y = base - Math.max(o.dpr, peak[i] * maxH)
          const x = i * slot + (slot - bw) / 2
          ctx.fillStyle = paletteAt(o.palette, i / (n - 1))
          ctx.beginPath()
          ctx.roundRect(x, y, bw, 3 * o.dpr, 1.5 * o.dpr)
          ctx.fill()
          ctx.fillStyle = paletteAt(o.palette, i / (n - 1), 0.16)
          ctx.fillRect(x, y + 4 * o.dpr, bw, base - y)
        }
      }
    }
  },

  {
    id: 'centre-out',
    name: 'Centre Out',
    blurb: 'Bass in the middle, treble pushed to both edges.',
    create() {
      const n = 33
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const base = H // flush with the transport
        const half = Math.floor(n / 2)
        const slot = W / n
        const bw = slot * 0.7
        for (let i = 0; i < n; i++) {
          const m = Math.abs(i - half)
          const v = clamp(b.values[m], 0, 1)
          const h = Math.max(o.dpr, v * H * 0.9)
          const x = i * slot + (slot - bw) / 2
          ctx.fillStyle = paletteAt(o.palette, m / half, 0.95)
          ctx.beginPath()
          ctx.roundRect(x, base - h, bw, h, [bw / 2, bw / 2, 0, 0])
          ctx.fill()
        }
      }
    }
  },

  {
    id: 'side-bars',
    name: 'Side Bars',
    blurb: 'The spectrum turned on its side, lows at the bottom.',
    create() {
      const n = 28
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const rowH = H / n
        const bh = rowH * 0.68
        const x0 = W * 0.06
        const maxW = W * 0.88
        for (let i = 0; i < n; i++) {
          const v = clamp(b.values[i], 0, 1)
          const y = H - (i + 1) * rowH + (rowH - bh) / 2
          const w = Math.max(o.dpr * 2, v * maxW)
          ctx.fillStyle = paletteAt(o.palette, i / (n - 1), 0.95)
          ctx.beginPath()
          ctx.roundRect(x0, y, w, bh, bh / 2)
          ctx.fill()
        }
      }
    }
  },

  {
    id: 'outline-bars',
    name: 'Outline Bars',
    blurb: 'Hollow bars with a bright cap riding each band.',
    create() {
      const n = 30
      const b = makeBands(n)
      const peak = new Float32Array(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const slot = W / n
        const bw = slot * 0.7
        const base = H // flush with the transport
        const maxH = H * 0.88
        ctx.lineWidth = Math.max(1, 1.4 * o.dpr)
        for (let i = 0; i < n; i++) {
          const v = clamp(b.values[i], 0, 1)
          peak[i] = Math.max(peak[i] - 0.007, v)
          const h = Math.max(2 * o.dpr, v * maxH)
          const x = i * slot + (slot - bw) / 2
          const col = paletteAt(o.palette, i / (n - 1))
          ctx.strokeStyle = col
          ctx.strokeRect(x, base - h, bw, h)
          ctx.fillStyle = col
          ctx.fillRect(x, base - Math.max(2 * o.dpr, peak[i] * maxH) - 3 * o.dpr, bw, 2.5 * o.dpr)
        }
      }
    }
  },

  /* ------------------------------------------- mirrored, centred on the glass */
  {
    id: 'mirror-led',
    name: 'Mirror LED',
    blurb: 'LED segments growing up and down from the centre line.',
    create() {
      const n = 32
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const mid = H / 2
        const rows = 12
        const slot = W / n
        const bw = slot * 0.68
        const cellH = (H * 0.44) / rows
        const gap = cellH * 0.26
        for (let i = 0; i < n; i++) {
          const lit = Math.round(clamp(b.values[i], 0, 1) * rows)
          const x = i * slot + (slot - bw) / 2
          for (let r = 0; r < rows; r++) {
            const on = r < lit
            const col = on ? paletteAt(o.palette, r / (rows - 1)) : 'rgba(255,255,255,0.05)'
            ctx.fillStyle = col
            ctx.fillRect(x, mid - (r + 1) * cellH + gap / 2, bw, cellH - gap)
            ctx.fillStyle = on ? paletteAt(o.palette, r / (rows - 1), 0.55) : 'rgba(255,255,255,0.035)'
            ctx.fillRect(x, mid + r * cellH + gap / 2, bw, cellH - gap)
          }
        }
      }
    }
  },

  {
    id: 'mirror-wall',
    name: 'Mirror Wall',
    blurb: 'The rack-mount wall, reflected below the centre line.',
    create() {
      const n = 56
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const mid = H / 2
        const rows = 16
        const cw = W / n
        const ch = (H * 0.46) / rows
        for (let i = 0; i < n; i++) {
          const lit = clamp(b.values[i], 0, 1) * rows
          for (let j = 0; j < rows; j++) {
            const frac = clamp(lit - j, 0, 1)
            const on = frac > 0.02
            const t = j / (rows - 1)
            ctx.fillStyle = on ? paletteAt(o.palette, t, 0.25 + frac * 0.75) : 'rgba(255,255,255,0.03)'
            ctx.fillRect(i * cw + cw * 0.18, mid - (j + 1) * ch + ch * 0.18, cw * 0.64, ch * 0.64)
            ctx.fillStyle = on ? paletteAt(o.palette, t, (0.25 + frac * 0.75) * 0.45) : 'rgba(255,255,255,0.02)'
            ctx.fillRect(i * cw + cw * 0.18, mid + j * ch + ch * 0.18, cw * 0.64, ch * 0.64)
          }
        }
      }
    }
  },

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
          peak[i] = Math.max(peak[i] - 0.006, v)
          const off = Math.max(o.dpr, peak[i] * reach)
          const x = i * slot + (slot - bw) / 2
          const col = paletteAt(o.palette, i / (n - 1))
          ctx.fillStyle = col
          ctx.beginPath()
          ctx.roundRect(x, mid - off, bw, 3 * o.dpr, 1.5 * o.dpr)
          ctx.fill()
          ctx.beginPath()
          ctx.roundRect(x, mid + off - 3 * o.dpr, bw, 3 * o.dpr, 1.5 * o.dpr)
          ctx.fill()
          ctx.fillStyle = paletteAt(o.palette, i / (n - 1), 0.12)
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
          ctx.strokeStyle = paletteAt(o.palette, i / (n - 1))
          ctx.strokeRect(x, mid - h, bw, h * 2)
        }
        ctx.fillStyle = 'rgba(255,255,255,0.07)'
        ctx.fillRect(0, mid - o.dpr / 2, W, o.dpr)
      }
    }
  },

  {
    id: 'mirror-dots',
    name: 'Mirror Dots',
    blurb: 'A dot board mirrored about the centre line.',
    create() {
      const n = 32
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const mid = H / 2
        const rows = 9
        const cw = W / n
        const ch = (H * 0.46) / rows
        const r = Math.min(cw, ch) * 0.3
        for (let i = 0; i < n; i++) {
          const lit = Math.round(clamp(b.values[i], 0, 1) * rows)
          for (let j = 0; j < rows; j++) {
            const on = j < lit
            const col = on ? paletteAt(o.palette, j / (rows - 1)) : 'rgba(255,255,255,0.05)'
            const x = (i + 0.5) * cw
            ctx.fillStyle = col
            ctx.beginPath()
            ctx.arc(x, mid - (j + 0.5) * ch, on ? r : r * 0.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = on ? paletteAt(o.palette, j / (rows - 1), 0.5) : 'rgba(255,255,255,0.035)'
            ctx.beginPath()
            ctx.arc(x, mid + (j + 0.5) * ch, on ? r : r * 0.5, 0, Math.PI * 2)
            ctx.fill()
          }
        }
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
          ctx.fillStyle = paletteAt(o.palette, t)
          ctx.beginPath()
          ctx.roundRect(x, mid - h, bw, h, [bw / 2, bw / 2, 0, 0])
          ctx.fill()
          const g = ctx.createLinearGradient(0, mid, 0, mid + h)
          g.addColorStop(0, paletteAt(o.palette, t, 0.5))
          g.addColorStop(0.4, paletteAt(o.palette, t, 0.14))
          g.addColorStop(1, paletteAt(o.palette, t, 0))
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
          ctx.strokeStyle = paletteAt(o.palette, i / (n - 1), 0.35 + v * 0.65)
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
        const pts = Array.from({ length: n }, (_, i) => ({
          x: (i / (n - 1)) * W,
          h: Math.max(0.03, a[i]) * H * 0.28
        }))
        ctx.beginPath()
        ctx.moveTo(pts[0].x, mid - pts[0].h)
        for (let i = 0; i < n - 1; i++) {
          const p0 = pts[i]
          const p1 = pts[i + 1]
          ctx.quadraticCurveTo(p0.x, mid - p0.h, (p0.x + p1.x) / 2, mid - (p0.h + p1.h) / 2)
        }
        ctx.lineTo(pts[n - 1].x, mid + pts[n - 1].h)
        for (let i = n - 1; i > 0; i--) {
          const p0 = pts[i]
          const p1 = pts[i - 1]
          ctx.quadraticCurveTo(p0.x, mid + p0.h, (p0.x + p1.x) / 2, mid + (p0.h + p1.h) / 2)
        }
        ctx.closePath()
        ctx.fillStyle = sweep(ctx, 0, 0, W, 0, o.palette, 0.85)
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
      const n = 72
      const ranges = bandRanges(n)
      const v = new Float32Array(n)
      const pk = new Float32Array(n).fill(0.09)
      const rings: Array<{ r: number; life: number }> = []
      let armed = true
      return (ctx, W, H, d, o) => {
        const cx = W / 2
        const cy = H / 2
        // Sized to fill the frame. Anything much smaller reads as a spinner.
        const minD = Math.min(W, H)

        if (d.beat > 0.5 && armed) {
          rings.push({ r: minD * 0.3, life: 1 })
          armed = false
        }
        if (d.beat < 0.22) armed = true
        if (rings.length > 20) rings.splice(0, rings.length - 20)

        for (let i = 0; i < n; i++) {
          v[i] += (adaptive(pk, i, bandValue(d.freq, ranges[i]), o) - v[i]) * 0.18
        }

        for (let i = rings.length - 1; i >= 0; i--) {
          const ring = rings[i]
          ring.r += minD * 0.008 + minD * 0.007 * ring.life
          ring.life -= 0.009
          if (ring.life <= 0 || ring.r > minD * 1.1) {
            rings.splice(i, 1)
            continue
          }
          ctx.beginPath()
          ctx.arc(cx, cy, ring.r, 0, Math.PI * 2)
          ctx.strokeStyle = rgba(o.accent, clamp(ring.life * 0.7, 0, 1))
          ctx.lineWidth = Math.max(1, minD * 0.009 * ring.life)
          ctx.stroke()
        }

        const R = minD * 0.26
        ctx.lineCap = 'round'
        ctx.lineWidth = Math.max(1.6, minD * 0.011)
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2
          const len = (0.025 + v[i] * 0.21) * minD
          ctx.strokeStyle = paletteAt(o.palette, i / (n - 1))
          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R)
          ctx.lineTo(cx + Math.cos(a) * (R + len), cy + Math.sin(a) * (R + len))
          ctx.stroke()
        }

        const core = R * 0.55 * (1 + d.beat * 0.16)
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, core)
        cg.addColorStop(0, rgba(o.accent, 0.45 + d.beat * 0.35))
        cg.addColorStop(1, rgba(o.accent, 0))
        ctx.beginPath()
        ctx.arc(cx, cy, core, 0, Math.PI * 2)
        ctx.fillStyle = cg
        ctx.fill()
      }
    }
  },

  {
    id: 'radial-ring',
    name: 'Radial Ring',
    blurb: 'A big spectrum ring, mirrored so lows meet at the bottom.',
    create() {
      const half = 84
      const ranges = bandRanges(half)
      const v = new Float32Array(half)
      const pk = new Float32Array(half).fill(0.09)
      let boom = 0
      return (ctx, W, H, d, o) => {
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        for (let i = 0; i < half; i++) {
          v[i] += (adaptive(pk, i, bandValue(d.freq, ranges[i]), o) - v[i]) * 0.18
        }
        boom = Math.max(d.beat, boom * 0.93)
        const R = minD * 0.27 * (1 + boom * 0.03)

        // Soft interior glow, never a filled disc: a solid centre reads as a mud
        // ball and leaves a dead gap between it and the rays.
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
        g.addColorStop(0, rgba(o.accent, 0.03 + d.bass * 0.15))
        g.addColorStop(1, rgba(o.accent, 0))
        ctx.beginPath()
        ctx.arc(cx, cy, R, 0, Math.PI * 2)
        ctx.fillStyle = g
        ctx.fill()

        const total = half * 2
        ctx.lineCap = 'round'
        ctx.lineWidth = Math.max(1.5, minD * 0.0095)
        for (let j = 0; j < total; j++) {
          const m = j < half ? j : total - 1 - j
          const a = Math.PI / 2 + ((j + 0.5) / total) * Math.PI * 2
          const len = (0.025 + v[m] * 0.22) * minD
          const ca = Math.cos(a)
          const sa = Math.sin(a)
          ctx.strokeStyle = paletteAt(o.palette, m / (half - 1))
          ctx.beginPath()
          ctx.moveTo(cx + ca * R, cy + sa * R)
          ctx.lineTo(cx + ca * (R + len), cy + sa * (R + len))
          ctx.stroke()
        }

        ctx.beginPath()
        ctx.arc(cx, cy, R, 0, Math.PI * 2)
        ctx.strokeStyle = rgba(o.accent, 0.5)
        ctx.lineWidth = Math.max(1, minD * 0.0035)
        ctx.stroke()
      }
    }
  },

  {
    id: 'radial-scope',
    name: 'Radial Scope',
    blurb: 'The waveform wrapped into a large breathing circle.',
    create() {
      const N = 256
      const r = new Float32Array(N)
      return (ctx, W, H, d, o) => {
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const R = minD * 0.3
        const amp = minD * 0.14 * o.sensitivity
        const n = d.time.length
        for (let i = 0; i < N; i++) {
          const t = ((d.time[Math.floor((i / N) * n) % n] - 128) / 128) * amp
          r[i] += (t - r[i]) * 0.2
        }
        ctx.beginPath()
        for (let i = 0; i <= N; i++) {
          const idx = i % N
          const sm = (r[(idx - 1 + N) % N] + r[idx] * 2 + r[(idx + 1) % N]) / 4
          const a = (idx / N) * Math.PI * 2 - Math.PI / 2
          const rr = R + sm
          const x = cx + Math.cos(a) * rr
          const y = cy + Math.sin(a) * rr
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        const g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R + amp)
        g.addColorStop(0, paletteAt(o.palette, 0.15, 0.13))
        g.addColorStop(1, paletteAt(o.palette, 0.85, 0.01))
        ctx.fillStyle = g
        ctx.fill()
        ctx.strokeStyle = sweep(ctx, cx - R, cy - R, cx + R, cy + R, o.palette)
        ctx.lineWidth = Math.max(1.8, minD * 0.006)
        ctx.stroke()
      }
    }
  },

  /* ------------------------------------------------------------------ grid */
  {
    id: 'dot-matrix',
    name: 'Dot Matrix',
    blurb: 'A board of dots lighting column by column.',
    create() {
      const n = 32
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const rows = 16
        const cw = W / n
        const ch = H / rows
        const r = Math.min(cw, ch) * 0.3
        for (let i = 0; i < n; i++) {
          const lit = Math.round(clamp(b.values[i], 0, 1) * rows)
          for (let j = 0; j < rows; j++) {
            const on = j < lit
            ctx.beginPath()
            ctx.arc((i + 0.5) * cw, H - (j + 0.5) * ch, on ? r : r * 0.5, 0, Math.PI * 2)
            ctx.fillStyle = on ? paletteAt(o.palette, j / (rows - 1)) : 'rgba(255,255,255,0.055)'
            ctx.fill()
          }
        }
      }
    }
  },

  {
    id: 'led-wall',
    name: 'LED Wall',
    blurb: 'Square pixels, bright where the energy is.',
    create() {
      const n = 28
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const rows = 14
        const cw = W / n
        const ch = H / rows
        const pad = Math.min(cw, ch) * 0.16
        for (let i = 0; i < n; i++) {
          const lit = clamp(b.values[i], 0, 1) * rows
          for (let j = 0; j < rows; j++) {
            const frac = clamp(lit - j, 0, 1)
            ctx.fillStyle =
              frac > 0.02
                ? paletteAt(o.palette, j / (rows - 1), 0.15 + frac * 0.85)
                : 'rgba(255,255,255,0.04)'
            ctx.fillRect(i * cw + pad, H - (j + 1) * ch + pad, cw - pad * 2, ch - pad * 2)
          }
        }
      }
    }
  },

  {
    id: 'heat-grid',
    name: 'Heat Grid',
    blurb: 'A coarse grid coloured by the energy in each cell.',
    create() {
      const n = 24
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o, 0.13)
        const cols = 12
        const rows = 8
        const cw = W / cols
        const ch = H / rows
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const idx = Math.floor(((i + j * cols) / (cols * rows)) * n)
            const v = clamp(b.values[Math.min(n - 1, idx)], 0, 1)
            ctx.fillStyle = paletteAt(o.palette, v, 0.06 + v * 0.9)
            ctx.fillRect(i * cw + 1, j * ch + 1, cw - 2, ch - 2)
          }
        }
      }
    }
  },

  {
    id: 'equaliser-wall',
    name: 'Equaliser Wall',
    blurb: 'A tall wall of narrow cells, the rack-mount look.',
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
            ctx.fillStyle =
              frac <= 0.02
                ? 'rgba(255,255,255,0.035)'
                : paletteAt(o.palette, j / (rows - 1), 0.25 + frac * 0.75)
            ctx.fillRect(i * cw + cw * 0.18, H - (j + 1) * ch + ch * 0.18, cw * 0.64, ch * 0.64)
          }
        }
      }
    }
  },

  /* -------------------------------------------------------------- abstract */
  {
    id: 'horizon',
    name: 'Horizon',
    blurb: 'A sun on the horizon with a skyline and its reflection.',
    create() {
      const n = 40
      const b = makeBands(n)
      return (ctx, W, H, d, o) => {
        b.update(d, o)
        const minD = Math.min(W, H)
        const hz = H * 0.62
        const sunR = minD * (0.14 + d.bass * 0.05)
        const g = ctx.createRadialGradient(W / 2, hz, 0, W / 2, hz, sunR)
        g.addColorStop(0, paletteAt(o.palette, 0.9, 0.85))
        g.addColorStop(1, paletteAt(o.palette, 0.4, 0.05))
        ctx.beginPath()
        ctx.arc(W / 2, hz, sunR, 0, Math.PI * 2)
        ctx.fillStyle = g
        ctx.fill()

        const slot = W / n
        for (let i = 0; i < n; i++) {
          const v = clamp(b.values[i], 0, 1)
          const h = v * H * 0.3
          const x = i * slot
          ctx.fillStyle = paletteAt(o.palette, i / (n - 1), 0.9)
          ctx.fillRect(x + slot * 0.12, hz - h, slot * 0.76, h)
          ctx.fillStyle = paletteAt(o.palette, i / (n - 1), 0.16)
          ctx.fillRect(x + slot * 0.12, hz, slot * 0.76, h * 0.7)
        }
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        ctx.fillRect(0, hz - o.dpr / 2, W, o.dpr)
      }
    }
  }
]

export const DEFAULT_STYLE_ID = 'wave-bars'

export function styleById(id: string): VizStyle {
  return VIZ_STYLES.find((s) => s.id === id) ?? VIZ_STYLES[0]
}
