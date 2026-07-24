/* Circular-family visualizer styles. Pushes onto window.PRISM_VIZ. */
(() => {
  const V = window.VIZ
  const TAU = Math.PI * 2

  function bands(s, n, fmax) {
    s.n = n
    s.ranges = V.bandRanges(n, 30, fmax || 12000)
    s.v = new Float32Array(n)
    s.pk = new Float32Array(n).fill(0.09)
  }
  function upd(s, d, o, mult) {
    const k = Math.min(1, V.rate(o) * (mult || 1))
    for (let i = 0; i < s.n; i++) {
      s.v[i] += (V.adaptive(s.pk, i, V.bandValue(d.freq, s.ranges[i]), o) - s.v[i]) * k
    }
  }

  window.PRISM_VIZ.push(
    {
      id: 'sunburst',
      name: 'Sunburst',
      family: 'Circular',
      blurb: 'Tapered rays firing outward from a small bright core.',
      init: (s) => bands(s, 80),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const R0 = minD * 0.08
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const a = (i / s.n) * TAU - Math.PI / 2
          const len = R0 + v * minD * 0.36
          const half = (TAU / s.n) * 0.36
          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(a - half) * R0, cy + Math.sin(a - half) * R0)
          ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len)
          ctx.lineTo(cx + Math.cos(a + half) * R0, cy + Math.sin(a + half) * R0)
          ctx.closePath()
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.3 + v * 0.7)
          ctx.fill()
        }
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R0 * 1.6)
        g.addColorStop(0, V.rgba(o.accent, 0.5 + d.bass * 0.4))
        g.addColorStop(1, V.rgba(o.accent, 0))
        ctx.beginPath()
        ctx.arc(cx, cy, R0 * 1.6, 0, TAU)
        ctx.fillStyle = g
        ctx.fill()
      }
    },

    {
      id: 'sonar',
      name: 'Sonar Sweep',
      family: 'Circular',
      blurb: 'A rotating sweep that lights each band as it passes, then fades.',
      trails: true,
      init(s) {
        bands(s, 96)
        s.ang = 0
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const R = minD * 0.4
        s.ang = (s.ang + 0.02) % TAU

        ctx.beginPath()
        ctx.arc(cx, cy, R, 0, TAU)
        ctx.strokeStyle = V.rgba(o.accent, 0.12)
        ctx.lineWidth = Math.max(1, minD * 0.002)
        ctx.stroke()

        const idx = Math.floor((s.ang / TAU) * s.n) % s.n
        const v = V.clamp(s.v[idx], 0, 1)
        const len = R * (0.25 + v * 0.75)
        const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(s.ang) * len, cy + Math.sin(s.ang) * len)
        g.addColorStop(0, V.rgba(o.accent, 0))
        g.addColorStop(1, V.paletteAt(o.palette, v, 1))
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(s.ang) * len, cy + Math.sin(s.ang) * len)
        ctx.strokeStyle = g
        ctx.lineWidth = Math.max(2, minD * 0.008)
        ctx.lineCap = 'round'
        ctx.stroke()
      }
    },

    {
      id: 'rose',
      name: 'Rose Curve',
      family: 'Circular',
      blurb: 'A mathematical rose whose petals swell and multiply with the mix.',
      init(s) {
        bands(s, 24)
        s.k = 4
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.6)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const targetK = 3 + Math.round(d.mid * 4)
        s.k += (targetK - s.k) * 0.02
        const R = minD * 0.36 * (0.55 + d.level * 1.2 * o.sensitivity)
        const steps = 480
        ctx.beginPath()
        for (let p = 0; p <= steps; p++) {
          const th = (p / steps) * TAU
          const r = Math.abs(Math.cos(s.k * th)) * R + minD * 0.03
          const x = cx + Math.cos(th) * r
          const y = cy + Math.sin(th) * r
          if (p === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.strokeStyle = V.sweep(ctx, cx - R, cy - R, cx + R, cy + R, o.palette)
        ctx.lineWidth = Math.max(1.5, minD * 0.005)
        ctx.shadowColor = V.rgba(o.accent, 0.5)
        ctx.shadowBlur = minD * 0.025
        ctx.stroke()
        ctx.shadowBlur = 0
      }
    },

    {
      id: 'nested-rings',
      name: 'Nested Rings',
      family: 'Circular',
      blurb: 'Rings of different sizes drifting apart on the beat.',
      init(s) {
        bands(s, 8)
        s.off = new Float32Array(8)
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.7)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          s.off[i] += (v - s.off[i]) * 0.08
          const r = minD * (0.06 + (i / s.n) * 0.34) * (1 + s.off[i] * 0.22)
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, TAU)
          ctx.strokeStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.25 + v * 0.7)
          ctx.lineWidth = Math.max(1.5, minD * (0.004 + v * 0.012))
          ctx.stroke()
        }
      }
    },

    {
      id: 'polar-bars',
      name: 'Polar Bars',
      family: 'Circular',
      blurb: 'Bars standing on a circle, pointing inward instead of out.',
      init: (s) => bands(s, 64),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const R = minD * 0.42
        ctx.lineCap = 'round'
        ctx.lineWidth = Math.max(1.5, minD * 0.008)
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const a = (i / s.n) * TAU - Math.PI / 2
          const len = minD * (0.02 + v * 0.26)
          const ca = Math.cos(a)
          const sa = Math.sin(a)
          ctx.strokeStyle = V.paletteAt(o.palette, i / (s.n - 1))
          ctx.beginPath()
          ctx.moveTo(cx + ca * R, cy + sa * R)
          ctx.lineTo(cx + ca * (R - len), cy + sa * (R - len))
          ctx.stroke()
        }
      }
    },

    {
      id: 'radial-dots',
      name: 'Radial Dots',
      family: 'Circular',
      blurb: 'Columns of dots marching outward, one column per band.',
      init: (s) => bands(s, 40),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const rows = 10
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const lit = Math.round(v * rows)
          const a = (i / s.n) * TAU - Math.PI / 2
          for (let r = 0; r < rows; r++) {
            const rr = minD * (0.08 + (r / rows) * 0.32)
            const on = r < lit
            ctx.beginPath()
            ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, minD * (on ? 0.006 : 0.0028), 0, TAU)
            ctx.fillStyle = on ? V.paletteAt(o.palette, r / rows) : 'rgba(255,255,255,0.07)'
            ctx.fill()
          }
        }
      }
    },

    {
      id: 'pie-segments',
      name: 'Pie Segments',
      family: 'Circular',
      blurb: 'A disc split into wedges, each one growing with its band.',
      init: (s) => bands(s, 24),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const R = minD * 0.4
        const span = TAU / s.n
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const r = minD * 0.07 + v * (R - minD * 0.07)
          const a0 = -Math.PI / 2 + i * span + span * 0.08
          const a1 = a0 + span * 0.84
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.arc(cx, cy, r, a0, a1)
          ctx.closePath()
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.3 + v * 0.65)
          ctx.fill()
        }
      }
    },

    {
      id: 'halo',
      name: 'Halo',
      family: 'Circular',
      blurb: 'A soft ring of light that thickens and brightens with the sound.',
      init: (s) => bands(s, 120),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.6)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const R = minD * 0.26 * (1 + d.bass * 0.08)
        for (let layer = 3; layer >= 0; layer--) {
          const t = layer / 3
          ctx.beginPath()
          for (let i = 0; i <= s.n; i++) {
            const idx = i % s.n
            const a = (i / s.n) * TAU - Math.PI / 2
            const r = R + s.v[idx] * minD * 0.07 * (1 - t * 0.5)
            const x = cx + Math.cos(a) * r
            const y = cy + Math.sin(a) * r
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.closePath()
          ctx.strokeStyle = V.paletteAt(o.palette, 0.4 + t * 0.4, (1 - t) * 0.7 + 0.08)
          ctx.lineWidth = minD * (0.004 + t * 0.03)
          ctx.stroke()
        }
      }
    },

    {
      id: 'clock',
      name: 'Clock Ticks',
      family: 'Circular',
      blurb: 'A dial of ticks with a hand that swings to the loudest band.',
      init: (s) => bands(s, 60),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const R = minD * 0.36
        let best = 0
        let bestI = 0
        for (let i = 0; i < s.n; i++) {
          if (s.v[i] > best) {
            best = s.v[i]
            bestI = i
          }
          const a = (i / s.n) * TAU - Math.PI / 2
          const v = V.clamp(s.v[i], 0, 1)
          const len = minD * (0.02 + v * 0.09)
          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R)
          ctx.lineTo(cx + Math.cos(a) * (R - len), cy + Math.sin(a) * (R - len))
          ctx.strokeStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.25 + v)
          ctx.lineWidth = Math.max(1, minD * 0.005)
          ctx.stroke()
        }
        const a = (bestI / s.n) * TAU - Math.PI / 2
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8)
        ctx.strokeStyle = V.rgba(o.accent, 0.9)
        ctx.lineWidth = Math.max(1.5, minD * 0.006)
        ctx.lineCap = 'round'
        ctx.stroke()
      }
    },

    {
      id: 'orbit-trails',
      name: 'Orbit Trails',
      family: 'Circular',
      blurb: 'Points sweeping around a ring and leaving light behind them.',
      trails: true,
      init(s) {
        bands(s, 6)
        s.ang = new Float32Array(6)
        for (let i = 0; i < 6; i++) s.ang[i] = (i / 6) * TAU
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.7)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          s.ang[i] += 0.006 + i * 0.0018 + v * 0.012
          const r = minD * (0.1 + (i / s.n) * 0.28) * (1 + v * 0.12)
          const x = cx + Math.cos(s.ang[i]) * r
          const y = cy + Math.sin(s.ang[i]) * r
          ctx.beginPath()
          ctx.arc(x, y, minD * (0.006 + v * 0.014), 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.5 + v * 0.5)
          ctx.fill()
        }
      }
    },

    {
      id: 'double-ring',
      name: 'Counter Rings',
      family: 'Circular',
      blurb: 'Two rings of rays turning in opposite directions.',
      init: (s) => bands(s, 48),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const spin = (d.t / 1000) * 0.12
        ctx.lineCap = 'round'
        const ring = (R, dir, tint, lw) => {
          ctx.lineWidth = lw
          for (let i = 0; i < s.n; i++) {
            const v = V.clamp(s.v[i], 0, 1)
            const a = (i / s.n) * TAU - Math.PI / 2 + spin * dir
            const len = minD * (0.015 + v * 0.13)
            const ca = Math.cos(a)
            const sa = Math.sin(a)
            ctx.strokeStyle = V.paletteAt(o.palette, tint, 0.3 + v * 0.7)
            ctx.beginPath()
            ctx.moveTo(cx + ca * R, cy + sa * R)
            ctx.lineTo(cx + ca * (R + len), cy + sa * (R + len))
            ctx.stroke()
          }
        }
        ring(minD * 0.16, 1, 0.15, Math.max(1.5, minD * 0.007))
        ring(minD * 0.3, -1, 0.85, Math.max(1.2, minD * 0.005))
      }
    },

    {
      id: 'radial-scope',
      name: 'Radial Scope',
      family: 'Circular',
      blurb: 'The raw waveform drawn round the clock, smoothed into a soft ring.',
      init(s) {
        s.N = 240
        s.r = new Float32Array(s.N)
      },
      draw(ctx, W, H, d, o, s) {
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const R = minD * 0.27
        const amp = minD * 0.11 * o.sensitivity
        const N = s.N
        const n = d.time.length
        const k = Math.max(0.08, V.rate(o))
        for (let i = 0; i < N; i++) {
          const t = ((d.time[Math.floor((i / N) * n) % n] - 128) / 128) * amp
          s.r[i] += (t - s.r[i]) * k
        }
        ctx.beginPath()
        for (let i = 0; i <= N; i++) {
          const idx = i % N
          const prev = s.r[(idx - 1 + N) % N]
          const next = s.r[(idx + 1) % N]
          const rr = R + (prev + s.r[idx] * 2 + next) / 4
          const a = (idx / N) * TAU - Math.PI / 2
          const x = cx + Math.cos(a) * rr
          const y = cy + Math.sin(a) * rr
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.strokeStyle = V.sweep(ctx, cx - R, cy - R, cx + R, cy + R, o.palette)
        ctx.lineWidth = Math.max(1.6, minD * 0.006)
        ctx.shadowColor = V.rgba(o.accent, 0.6)
        ctx.shadowBlur = minD * 0.03
        ctx.stroke()
        ctx.shadowBlur = 0
      }
    },

    {
      id: 'gauge',
      name: 'Level Gauge',
      family: 'Circular',
      blurb: 'A half-circle meter reading overall loudness, with band ticks.',
      init: (s) => bands(s, 36),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H * 0.72
        const minD = Math.min(W, H)
        const R = minD * 0.42
        const a0 = Math.PI
        const a1 = TAU
        ctx.beginPath()
        ctx.arc(cx, cy, R, a0, a1)
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'
        ctx.lineWidth = minD * 0.03
        ctx.lineCap = 'butt'
        ctx.stroke()

        const lvl = V.clamp(Math.pow(d.level * 2.2, 0.8) * o.sensitivity, 0, 1)
        ctx.beginPath()
        ctx.arc(cx, cy, R, a0, a0 + (a1 - a0) * lvl)
        ctx.strokeStyle = V.sweep(ctx, cx - R, 0, cx + R, 0, o.palette)
        ctx.lineWidth = minD * 0.03
        ctx.stroke()

        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const a = a0 + (a1 - a0) * (i / (s.n - 1))
          const rIn = R + minD * 0.025
          const len = minD * (0.008 + v * 0.05)
          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn)
          ctx.lineTo(cx + Math.cos(a) * (rIn + len), cy + Math.sin(a) * (rIn + len))
          ctx.strokeStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.3 + v * 0.7)
          ctx.lineWidth = Math.max(1.2, minD * 0.005)
          ctx.stroke()
        }
      }
    },

    {
      id: 'bloom',
      name: 'Bloom',
      family: 'Circular',
      blurb: 'Overlapping petals that open with the mids and close between hits.',
      init: (s) => bands(s, 12),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.7)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const spin = (d.t / 1000) * 0.06
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const a = (i / s.n) * TAU + spin
          const len = minD * (0.08 + v * 0.26)
          const wid = minD * (0.03 + v * 0.05)
          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(a)
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.quadraticCurveTo(wid, len * 0.5, 0, len)
          ctx.quadraticCurveTo(-wid, len * 0.5, 0, 0)
          ctx.closePath()
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.18 + v * 0.5)
          ctx.fill()
          ctx.restore()
        }
      }
    }
  )
})()
