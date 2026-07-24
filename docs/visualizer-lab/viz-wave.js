/* Wave-family visualizer styles. Pushes onto window.PRISM_VIZ.
 *
 * Most of these use the shared wave model: a flat line at silence where each
 * frequency band raises ONE perfect symmetric wave of constant width, and only
 * height and position along the line change.
 */
(() => {
  const V = window.VIZ
  const WL = V.WAVE_WIDTH

  window.PRISM_VIZ.push(
    {
      id: 'stepped-wave',
      name: 'Stepped Wave',
      family: 'Wave',
      blurb: 'The wave quantised into flat steps, like a staircase readout.',
      init: (s) => V.initWave(s),
      draw(ctx, W, H, d, o, s) {
        V.updateWave(s, d, o)
        const mid = H / 2
        const steps = 64
        let ly = 0
        ctx.beginPath()
        for (let p = 0; p <= steps; p++) {
          const u = p / steps
          const y = mid - V.waveAt(s, u, WL) * H * 0.3
          const x = u * W
          if (p === 0) ctx.moveTo(x, y)
          else {
            ctx.lineTo(x, ly) // horizontal run, then the riser: a staircase
            ctx.lineTo(x, y)
          }
          ly = y
        }
        ctx.strokeStyle = V.sweep(ctx, 0, 0, W, 0, o.palette)
        ctx.lineWidth = 2 * o.dpr
        ctx.stroke()
      }
    },

    {
      id: 'wave-spikes',
      name: 'Wave Spikes',
      family: 'Wave',
      blurb: 'Each band throws a single sharp spike instead of a rounded wave.',
      init: (s) => V.initWave(s),
      draw(ctx, W, H, d, o, s) {
        V.updateWave(s, d, o)
        const mid = H / 2
        const w = WL * W * 0.8
        ctx.fillStyle = 'rgba(255,255,255,0.05)'
        ctx.fillRect(0, mid - o.dpr / 2, W, o.dpr)
        for (let i = 0; i < s.n; i++) {
          const h = s.h[i] * H * 0.38
          if (h < o.dpr) continue
          const x = s.pos[i] * W
          const up = i % 2 === 0 ? -1 : 1
          ctx.beginPath()
          ctx.moveTo(x - w / 2, mid)
          ctx.lineTo(x, mid + up * h)
          ctx.lineTo(x + w / 2, mid)
          ctx.closePath()
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.9)
          ctx.fill()
        }
      }
    },

    {
      id: 'twin-wave',
      name: 'Twin Wave',
      family: 'Wave',
      blurb: 'Two lines, one for the low half of the spectrum and one for the high.',
      init(s) {
        V.initWave(s)
        s.lo = { n: s.n, h: s.h, pos: s.pos }
      },
      draw(ctx, W, H, d, o, s) {
        V.updateWave(s, d, o)
        const steps = 220
        const half = Math.floor(s.n / 2)
        const line = (from, to, yBase, amp, t) => {
          ctx.beginPath()
          for (let p = 0; p <= steps; p++) {
            const u = p / steps
            let y = 0
            for (let i = from; i < to; i++) {
              const uu = (i - from + 0.5) / (to - from)
              if (s.h[i] > 0.004) y += s.h[i] * V.wavelet(u - uu, WL * 1.6)
            }
            const py = yBase - y * amp
            if (p === 0) ctx.moveTo(0, py)
            else ctx.lineTo(u * W, py)
          }
          ctx.strokeStyle = V.paletteAt(o.palette, t)
          ctx.lineWidth = 2.2 * o.dpr
          ctx.lineJoin = 'round'
          ctx.stroke()
        }
        line(0, half, H * 0.34, H * 0.2, 0.1)
        line(half, s.n, H * 0.72, H * 0.2, 0.85)
      }
    },

    {
      id: 'wave-fill',
      name: 'Wave Fill',
      family: 'Wave',
      blurb: 'The wave with everything under it flooded in colour.',
      init: (s) => V.initWave(s),
      draw(ctx, W, H, d, o, s) {
        V.updateWave(s, d, o)
        const mid = H * 0.62
        const steps = 240
        ctx.beginPath()
        ctx.moveTo(0, H)
        for (let p = 0; p <= steps; p++) {
          const u = p / steps
          ctx.lineTo(u * W, mid - V.waveAt(s, u, WL) * H * 0.3)
        }
        ctx.lineTo(W, H)
        ctx.closePath()
        const g = ctx.createLinearGradient(0, mid - H * 0.3, 0, H)
        g.addColorStop(0, V.paletteAt(o.palette, 0.8, 0.75))
        g.addColorStop(1, V.paletteAt(o.palette, 0.1, 0.06))
        ctx.fillStyle = g
        ctx.fill()
        ctx.strokeStyle = V.sweep(ctx, 0, 0, W, 0, o.palette)
        ctx.lineWidth = 2 * o.dpr
        ctx.stroke()
      }
    },

    {
      id: 'string-pluck',
      name: 'Plucked String',
      family: 'Wave',
      blurb: 'A taut string that gets plucked on every kick and rings out.',
      init(s) {
        s.n = 128
        s.y = new Float32Array(s.n)
        s.vel = new Float32Array(s.n)
        s.armed = true
      },
      draw(ctx, W, H, d, o, s) {
        // simple 1D wave equation, driven by transients
        if (d.beat > 0.5 && s.armed) {
          const at = Math.floor(s.n * (0.25 + d.bass * 0.5))
          s.vel[Math.min(s.n - 1, at)] += d.beat * 2.4 * o.sensitivity
          s.armed = false
        }
        if (d.beat < 0.22) s.armed = true
        const tension = 0.32
        for (let i = 1; i < s.n - 1; i++) {
          s.vel[i] += (s.y[i - 1] + s.y[i + 1] - 2 * s.y[i]) * tension
          s.vel[i] *= 0.992
        }
        for (let i = 1; i < s.n - 1; i++) s.y[i] += s.vel[i] * 0.5
        s.y[0] = s.y[s.n - 1] = 0

        const mid = H / 2
        ctx.beginPath()
        for (let i = 0; i < s.n; i++) {
          const x = (i / (s.n - 1)) * W
          const y = mid + V.clamp(s.y[i], -6, 6) * H * 0.045
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = V.sweep(ctx, 0, 0, W, 0, o.palette)
        ctx.lineWidth = 2.2 * o.dpr
        ctx.shadowColor = V.rgba(o.accent, 0.5)
        ctx.shadowBlur = 12 * o.dpr
        ctx.stroke()
        ctx.shadowBlur = 0
      }
    },

    {
      id: 'travelling',
      name: 'Travelling Wave',
      family: 'Wave',
      blurb: 'Waves are born at their band and drift outward to the edges.',
      trails: true,
      init(s) {
        V.initWave(s)
        s.blips = []
        s.armed = new Float32Array(s.n)
      },
      draw(ctx, W, H, d, o, s) {
        V.updateWave(s, d, o)
        for (let i = 0; i < s.n; i++) {
          if (s.h[i] > 0.35 && s.armed[i] <= 0) {
            s.blips.push({ u: s.pos[i], h: s.h[i], life: 1, dir: i % 2 ? 1 : -1, c: i / (s.n - 1) })
            s.armed[i] = 1
          }
          if (s.h[i] < 0.15) s.armed[i] = 0
        }
        if (s.blips.length > 60) s.blips.splice(0, s.blips.length - 60)

        const mid = H / 2
        ctx.fillStyle = 'rgba(255,255,255,0.05)'
        ctx.fillRect(0, mid - o.dpr / 2, W, o.dpr)

        for (let i = s.blips.length - 1; i >= 0; i--) {
          const b = s.blips[i]
          b.u += b.dir * 0.004
          b.life -= 0.012
          if (b.life <= 0 || b.u < -0.1 || b.u > 1.1) {
            s.blips.splice(i, 1)
            continue
          }
          const steps = 26
          const w = WL
          ctx.beginPath()
          for (let p = 0; p <= steps; p++) {
            const u = b.u - w * 1.5 + (p / steps) * w * 3
            const y = mid - b.h * b.life * V.wavelet(u - b.u, w) * H * 0.3
            if (p === 0) ctx.moveTo(u * W, y)
            else ctx.lineTo(u * W, y)
          }
          ctx.strokeStyle = V.paletteAt(o.palette, b.c, b.life)
          ctx.lineWidth = 2 * o.dpr
          ctx.stroke()
        }
      }
    },

    {
      id: 'layered-wave',
      name: 'Layered Wave',
      family: 'Wave',
      blurb: 'Several copies of the wave stacked with a delay, like a rolling swell.',
      init(s) {
        V.initWave(s)
        s.hist = []
      },
      draw(ctx, W, H, d, o, s) {
        V.updateWave(s, d, o)
        s.hist.unshift(Float32Array.from(s.h))
        if (s.hist.length > 40) s.hist.pop()
        const mid = H / 2
        const steps = 150
        const layers = 5
        for (let L = layers - 1; L >= 0; L--) {
          const snap = s.hist[Math.min(s.hist.length - 1, L * 7)]
          if (!snap) continue
          const saveH = s.h
          s.h = snap
          ctx.beginPath()
          for (let p = 0; p <= steps; p++) {
            const u = p / steps
            const y = mid - V.waveAt(s, u, WL) * H * 0.24 + (L - layers / 2) * H * 0.055
            if (p === 0) ctx.moveTo(0, y)
            else ctx.lineTo(u * W, y)
          }
          s.h = saveH
          ctx.strokeStyle = V.paletteAt(o.palette, L / (layers - 1), 1 - L * 0.16)
          ctx.lineWidth = (L === 0 ? 2.4 : 1.5) * o.dpr
          ctx.stroke()
        }
      }
    },

    {
      id: 'wave-bar-hybrid',
      name: 'Wave Comb',
      family: 'Wave',
      blurb: 'Vertical ticks whose lengths trace the wave, drawn like a comb.',
      init: (s) => V.initWave(s),
      draw(ctx, W, H, d, o, s) {
        V.updateWave(s, d, o)
        const mid = H / 2
        const ticks = Math.max(40, Math.min(180, Math.round(W / (9 * o.dpr))))
        ctx.lineWidth = Math.max(1.2, o.dpr * 1.6)
        ctx.lineCap = 'round'
        for (let i = 0; i <= ticks; i++) {
          const u = i / ticks
          const y = V.waveAt(s, u, WL) * H * 0.3
          const x = u * W
          ctx.strokeStyle = V.paletteAt(o.palette, u, V.clamp(0.25 + Math.abs(y) / (H * 0.1), 0, 1))
          ctx.beginPath()
          ctx.moveTo(x, mid)
          ctx.lineTo(x, mid - y)
          ctx.stroke()
        }
      }
    },

    {
      id: 'contour',
      name: 'Contour Lines',
      family: 'Wave',
      blurb: 'The wave repeated as nested contours, like a topographic map.',
      init: (s) => V.initWave(s),
      draw(ctx, W, H, d, o, s) {
        V.updateWave(s, d, o)
        const mid = H / 2
        const steps = 160
        const lines = 9
        for (let L = 0; L < lines; L++) {
          const t = L / (lines - 1)
          const scale = 0.25 + t * 0.85
          ctx.beginPath()
          for (let p = 0; p <= steps; p++) {
            const u = p / steps
            const y = mid - V.waveAt(s, u, WL) * H * 0.26 * scale
            if (p === 0) ctx.moveTo(0, y)
            else ctx.lineTo(u * W, y)
          }
          ctx.strokeStyle = V.paletteAt(o.palette, t, 0.22 + t * 0.6)
          ctx.lineWidth = (0.8 + t * 1.4) * o.dpr
          ctx.stroke()
        }
      }
    },

    {
      id: 'wave-shadow',
      name: 'Wave & Shadow',
      family: 'Wave',
      blurb: 'A bright wave over a soft blurred double, for depth.',
      init: (s) => V.initWave(s),
      draw(ctx, W, H, d, o, s) {
        V.updateWave(s, d, o)
        const mid = H / 2
        const steps = 200
        const path = (amp, dy) => {
          ctx.beginPath()
          for (let p = 0; p <= steps; p++) {
            const u = p / steps
            const y = mid - V.waveAt(s, u, WL) * amp + dy
            if (p === 0) ctx.moveTo(0, y)
            else ctx.lineTo(u * W, y)
          }
        }
        path(H * 0.24, H * 0.05)
        ctx.strokeStyle = V.rgba(o.accent, 0.2)
        ctx.lineWidth = 10 * o.dpr
        ctx.lineJoin = 'round'
        ctx.stroke()

        path(H * 0.3, 0)
        ctx.strokeStyle = V.sweep(ctx, 0, 0, W, 0, o.palette)
        ctx.lineWidth = 2.4 * o.dpr
        ctx.stroke()
      }
    },

    {
      id: 'raw-scope',
      name: 'Soft Scope',
      family: 'Wave',
      blurb: 'The real waveform, heavily smoothed so it reads without the jitter.',
      init(s) {
        s.buf = new Float32Array(256)
      },
      draw(ctx, W, H, d, o, s) {
        const mid = H / 2
        const N = s.buf.length
        const n = d.time.length
        const k = Math.max(0.05, V.rate(o))
        for (let i = 0; i < N; i++) {
          const t = (d.time[Math.floor((i / N) * n)] - 128) / 128
          s.buf[i] += (t - s.buf[i]) * k
        }
        ctx.beginPath()
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * W
          const y = mid + s.buf[i] * H * 0.3 * o.sensitivity
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = V.sweep(ctx, 0, 0, W, 0, o.palette)
        ctx.lineWidth = 2.4 * o.dpr
        ctx.lineJoin = 'round'
        ctx.shadowColor = V.rgba(o.accent, 0.45)
        ctx.shadowBlur = 10 * o.dpr
        ctx.stroke()
        ctx.shadowBlur = 0
      }
    },

    {
      id: 'wave-scroll',
      name: 'Scrolling Wave',
      family: 'Wave',
      blurb: 'Loudness written out left to right and scrolling away, like tape.',
      init(s) {
        s.cap = 400
        s.hist = new Float32Array(s.cap)
        s.tone = new Float32Array(s.cap)
        s.head = 0
      },
      draw(ctx, W, H, d, o, s) {
        let peak = 0
        for (let i = 0; i < d.time.length; i += 4) {
          const v = Math.abs(d.time[i] - 128) / 128
          if (v > peak) peak = v
        }
        s.hist[s.head] = V.clamp(Math.pow(peak, 1.6) * o.sensitivity, 0, 1.1)
        const tot = d.bass + d.mid + d.treble + 1e-6
        s.tone[s.head] = V.clamp((d.mid * 0.5 + d.treble) / tot, 0, 1)
        s.head = (s.head + 1) % s.cap

        const mid = H / 2
        const bw = W / s.cap
        for (let x = 0; x < s.cap; x++) {
          const idx = (s.head + x) % s.cap
          const half = s.hist[idx] * H * 0.4
          if (half <= 0) continue
          ctx.fillStyle = V.paletteAt(o.palette, s.tone[idx], 0.9)
          ctx.fillRect(x * bw, mid - half, Math.max(1, bw * 0.85), half * 2)
        }
      }
    }
  )
})()
