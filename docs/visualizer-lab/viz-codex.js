/* Codex visualizer styles. Pushes onto window.PRISM_VIZ. */
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
  // Deterministic pseudo-random, so layouts are stable across resizes.
  function rnd(i) {
    const x = Math.sin(i * 127.1) * 43758.5453
    return x - Math.floor(x)
  }

  window.PRISM_VIZ.push(
    /* ============================================================ WAVE ==== */
    {
      id: 'cx-scope-xy',
      name: 'Scope XY',
      family: 'Wave',
      blurb: 'A phase-plot oscilloscope: the waveform crossed against a delayed copy of itself.',
      trails: true,
      init(s) {
        s.shift = 40
        s.ph = 0
      },
      draw(ctx, W, H, d, o, s) {
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const amp = minD * 0.32 * o.sensitivity
        const n = d.time.length
        const targetShift = 18 + d.mid * 90
        s.shift += (targetShift - s.shift) * 0.02
        const shift = Math.max(4, Math.round(s.shift))
        s.ph += 0.015
        const idle = 0.035
        ctx.beginPath()
        for (let i = 0; i < n; i += 2) {
          const x = (d.time[i] - 128) / 128 + Math.cos(s.ph + i * 0.002) * idle
          const y = (d.time[(i + shift) % n] - 128) / 128 + Math.sin(s.ph * 1.3 + i * 0.002) * idle
          const px = cx + x * amp
          const py = cy + y * amp
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.strokeStyle = V.sweep(ctx, cx - amp, cy - amp, cx + amp, cy + amp, o.palette)
        ctx.lineWidth = Math.max(1.2, minD * 0.0032)
        ctx.shadowColor = V.rgba(o.accent, 0.5)
        ctx.shadowBlur = minD * 0.02
        ctx.stroke()
        ctx.shadowBlur = 0
      }
    },

    {
      id: 'cx-heartbeat',
      name: 'Heartbeat',
      family: 'Wave',
      blurb: 'An ECG trace that idles with a soft pulse and spikes into a real QRS complex on the beat.',
      init(s) {
        s.N = 240
        s.buf = new Float32Array(s.N)
        s.armed = true
        s.phase = -1
        s.idlePh = 0
      },
      draw(ctx, W, H, d, o, s) {
        const minD = Math.min(W, H)
        for (let i = 0; i < s.N - 1; i++) s.buf[i] = s.buf[i + 1]

        if (d.beat > 0.5 && s.armed) {
          s.phase = 0
          s.armed = false
        }
        if (d.beat < 0.2) s.armed = true

        s.idlePh += 0.09
        let v = Math.sin(s.idlePh) * 0.035 + (Math.random() - 0.5) * 0.02 * (0.4 + d.level)

        const shape = [0, 0.04, -0.05, 0.08, -0.55, 1, -0.32, 0.12, 0.04, 0, 0, 0]
        if (s.phase >= 0) {
          if (s.phase < shape.length) {
            v += shape[s.phase] * (0.55 + d.beat * 0.55)
            s.phase++
          } else s.phase = -1
        }
        s.buf[s.N - 1] = v

        const midY = H * 0.5
        const ampY = H * 0.34
        ctx.beginPath()
        for (let i = 0; i < s.N; i++) {
          const x = (i / (s.N - 1)) * W
          const y = midY - s.buf[i] * ampY
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = V.paletteAt(o.palette, 0.5, 0.95)
        ctx.lineWidth = Math.max(1.4, minD * 0.0035)
        ctx.shadowColor = V.rgba(o.accent, 0.55)
        ctx.shadowBlur = minD * 0.016
        ctx.stroke()
        ctx.shadowBlur = 0

        ctx.strokeStyle = 'rgba(255,255,255,0.05)'
        ctx.lineWidth = Math.max(1, minD * 0.0015)
        ctx.beginPath()
        ctx.moveTo(0, midY)
        ctx.lineTo(W, midY)
        ctx.stroke()
      }
    },

    {
      id: 'cx-seismograph',
      name: 'Seismograph',
      family: 'Wave',
      blurb: 'Three drum-recorder traces, one per register, scratching out a random-walk wiggle.',
      init(s) {
        s.N = 220
        s.rows = 3
        s.buf = new Float32Array(s.N * s.rows)
        s.vel = new Float32Array(s.rows)
      },
      draw(ctx, W, H, d, o, s) {
        const minD = Math.min(W, H)
        const drive = [d.bass, d.mid, d.treble]
        for (let r = 0; r < s.rows; r++) {
          const off = r * s.N
          for (let i = 0; i < s.N - 1; i++) s.buf[off + i] = s.buf[off + i + 1]
          s.vel[r] += (Math.random() - 0.5) * (0.05 + drive[r] * 0.4 * o.sensitivity)
          s.vel[r] *= 0.82
          const v = s.buf[off + s.N - 2] * 0.88 + s.vel[r]
          s.buf[off + s.N - 1] = V.clamp(v, -1, 1)
        }

        for (let r = 0; r < s.rows; r++) {
          const off = r * s.N
          const rowY = H * (0.22 + r * 0.28)
          ctx.strokeStyle = 'rgba(255,255,255,0.04)'
          ctx.lineWidth = Math.max(1, minD * 0.0012)
          ctx.beginPath()
          ctx.moveTo(0, rowY)
          ctx.lineTo(W, rowY)
          ctx.stroke()

          const ampY = H * 0.11
          ctx.beginPath()
          for (let i = 0; i < s.N; i++) {
            const x = (i / (s.N - 1)) * W
            const y = rowY - s.buf[off + i] * ampY
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.strokeStyle = V.paletteAt(o.palette, r / (s.rows - 1), 0.85)
          ctx.lineWidth = Math.max(1.2, minD * 0.003)
          ctx.stroke()
        }
      }
    },

    {
      id: 'cx-springwave',
      name: 'Spring Wave',
      family: 'Wave',
      blurb: 'A row of mass-and-spring oscillators, each chasing its band and overshooting like a real spring.',
      init(s) {
        s.n = 40
        s.ranges = V.bandRanges(s.n)
        s.pk = new Float32Array(s.n).fill(0.09)
        s.x = new Float32Array(s.n)
        s.vel = new Float32Array(s.n)
      },
      draw(ctx, W, H, d, o, s) {
        const minD = Math.min(W, H)
        const mid = H / 2
        const k = 0.1
        const damp = 0.8
        for (let i = 0; i < s.n; i++) {
          const target = V.adaptive(s.pk, i, V.bandValue(d.freq, s.ranges[i]), o)
          s.vel[i] += (target - s.x[i]) * k
          s.vel[i] *= damp
          s.x[i] += s.vel[i]
        }
        const pts = []
        for (let i = 0; i < s.n; i++) {
          const x = ((i + 0.5) / s.n) * W
          const y = mid - V.clamp(s.x[i], -0.25, 1.15) * H * 0.32
          pts.push({ x, y })
        }
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 0; i < pts.length - 1; i++) {
          const cxp = (pts[i].x + pts[i + 1].x) / 2
          const cyp = (pts[i].y + pts[i + 1].y) / 2
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, cxp, cyp)
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
        ctx.strokeStyle = V.sweep(ctx, 0, 0, W, 0, o.palette)
        ctx.lineWidth = Math.max(1.6, minD * 0.0045)
        ctx.lineJoin = 'round'
        ctx.shadowColor = V.rgba(o.accent, 0.4)
        ctx.shadowBlur = minD * 0.015
        ctx.stroke()
        ctx.shadowBlur = 0
        for (let i = 0; i < pts.length; i++) {
          const v = V.clamp(s.x[i], 0, 1)
          ctx.beginPath()
          ctx.arc(pts[i].x, pts[i].y, Math.max(1.4 * o.dpr, minD * (0.003 + v * 0.006)), 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.5 + v * 0.5)
          ctx.fill()
        }
      }
    },

    {
      id: 'cx-interference',
      name: 'Interference',
      family: 'Wave',
      blurb: 'Two ripple sources on the line beat against each other, drifting apart with the bass.',
      init(s) {
        s.ph = 0
      },
      draw(ctx, W, H, d, o, s) {
        const minD = Math.min(W, H)
        const mid = H / 2
        s.ph += 0.05 + d.level * 0.08
        const src1 = 0.5 - (0.08 + d.bass * 0.32)
        const src2 = 0.5 + (0.08 + d.bass * 0.32)
        const k1 = 26
        const k2 = 34 + d.treble * 20
        const amp = H * 0.18 * (0.4 + d.level * 1.0 * o.sensitivity)
        const steps = Math.max(140, Math.min(420, Math.round(W / (2.4 * o.dpr))))
        ctx.beginPath()
        for (let p = 0; p <= steps; p++) {
          const u = p / steps
          const d1 = Math.abs(u - src1)
          const d2 = Math.abs(u - src2)
          const y = (Math.sin(d1 * k1 - s.ph) + Math.sin(d2 * k2 - s.ph)) * 0.5 * amp
          const x = u * W
          if (p === 0) ctx.moveTo(x, mid - y)
          else ctx.lineTo(x, mid - y)
        }
        ctx.strokeStyle = V.sweep(ctx, 0, 0, W, 0, o.palette)
        ctx.lineWidth = Math.max(1.4, minD * 0.0032)
        ctx.shadowColor = V.rgba(o.accent, 0.4)
        ctx.shadowBlur = minD * 0.012
        ctx.stroke()
        ctx.shadowBlur = 0
        for (const sPos of [src1, src2]) {
          ctx.beginPath()
          ctx.arc(sPos * W, mid, Math.max(1.5 * o.dpr, minD * 0.006), 0, TAU)
          ctx.fillStyle = V.rgba(o.accent, 0.5)
          ctx.fill()
        }
      }
    },

    /* ============================================================ BARS ==== */
    {
      id: 'cx-skyline',
      name: 'Skyline',
      family: 'Bars',
      blurb: 'A city skyline built from the spectrum, with a dim parallax layer behind it.',
      init: (s) => bands(s, 32),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const base = H * 0.95
        const slot = W / s.n

        ctx.fillStyle = 'rgba(255,255,255,0.05)'
        for (let i = 0; i < s.n; i++) {
          const v = (V.clamp(s.v[i], 0, 1) + V.clamp(s.v[(i + 1) % s.n], 0, 1)) / 2
          const h = v * H * 0.55
          const x = (i + 0.5) * slot
          ctx.fillRect(x, base - h, slot * 0.9, h)
        }

        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const h = Math.max(o.dpr, v * H * 0.72)
          const bw = slot * 0.78
          const x = i * slot + (slot - bw) / 2
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.92)
          ctx.fillRect(x, base - h, bw, h)

          ctx.fillStyle = 'rgba(255,255,255,0.5)'
          const rows = Math.max(1, Math.floor(h / (slot * 0.5)))
          for (let r = 0; r < rows; r++) {
            if ((i * 7 + r * 13) % 5 === 0) {
              ctx.fillRect(x + bw * 0.18, base - h + r * (slot * 0.5) + slot * 0.14, bw * 0.18, slot * 0.14)
            }
          }
        }
        ctx.fillStyle = 'rgba(255,255,255,0.08)'
        ctx.fillRect(0, base, W, Math.max(o.dpr, H * 0.005))
      }
    },

    {
      id: 'cx-vu-needles',
      name: 'VU Needles',
      family: 'Bars',
      blurb: 'Twin analog VU meters swinging on bass and treble, with spring-loaded needles.',
      init(s) {
        s.ang = new Float32Array(2)
        s.vel = new Float32Array(2)
      },
      draw(ctx, W, H, d, o, s) {
        const minD = Math.min(W, H)
        const drive = [d.bass, d.treble]
        const cy = H * 0.78
        const R = minD * 0.32
        const cxs = [W * 0.28, W * 0.72]
        for (let m = 0; m < 2; m++) {
          const target = V.clamp(Math.pow(drive[m] * 1.6 * o.sensitivity, 0.8), 0, 1.08)
          s.vel[m] += (target - s.ang[m]) * 0.05
          s.vel[m] *= 0.78
          s.ang[m] += s.vel[m]

          const cx = cxs[m]
          ctx.beginPath()
          ctx.arc(cx, cy, R, Math.PI, TAU)
          ctx.strokeStyle = 'rgba(255,255,255,0.08)'
          ctx.lineWidth = Math.max(1, minD * 0.006)
          ctx.stroke()

          ctx.beginPath()
          ctx.arc(cx, cy, R, Math.PI * 1.72, TAU)
          ctx.strokeStyle = 'rgba(255,90,90,0.35)'
          ctx.lineWidth = Math.max(1, minD * 0.006)
          ctx.stroke()

          const t = V.clamp(s.ang[m], 0, 1.08)
          const a = Math.PI + t * Math.PI
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92)
          ctx.strokeStyle = V.paletteAt(o.palette, m ? 0.85 : 0.15, 0.95)
          ctx.lineWidth = Math.max(1.4, minD * 0.006)
          ctx.lineCap = 'round'
          ctx.stroke()

          ctx.beginPath()
          ctx.arc(cx, cy, minD * 0.012, 0, TAU)
          ctx.fillStyle = V.rgba(o.accent, 0.8)
          ctx.fill()
        }
      }
    },

    {
      id: 'cx-piano-keys',
      name: 'Piano Keys',
      family: 'Bars',
      blurb: 'A keyboard along the floor, keys glowing with the band that falls under them.',
      init: (s) => bands(s, 28),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const keys = s.n
        const kw = W / keys
        const base = H * 0.9
        const kh = H * 0.24
        for (let i = 0; i < keys; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const x = i * kw

          const g = ctx.createLinearGradient(0, base - kh - v * H * 0.35, 0, base)
          g.addColorStop(0, V.paletteAt(o.palette, i / (keys - 1), 0.5 * v))
          g.addColorStop(1, V.paletteAt(o.palette, i / (keys - 1), 0))
          ctx.fillStyle = g
          ctx.fillRect(x, base - kh - v * H * 0.35, kw, kh + v * H * 0.35)

          ctx.fillStyle = V.paletteAt(o.palette, i / (keys - 1), 0.18 + v * 0.75)
          ctx.fillRect(x + kw * 0.04, base, kw * 0.92, kh)
          ctx.strokeStyle = 'rgba(0,0,0,0.4)'
          ctx.lineWidth = Math.max(1, o.dpr)
          ctx.strokeRect(x + kw * 0.04, base, kw * 0.92, kh)

          const p = i % 7
          if (p === 0 || p === 1 || p === 3 || p === 4 || p === 5) {
            ctx.fillStyle = 'rgba(10,10,14,0.85)'
            ctx.fillRect(x + kw * 0.6, base, kw * 0.7, kh * 0.6)
          }
        }
      }
    },

    {
      id: 'cx-pendulums',
      name: 'Pendulum Row',
      family: 'Bars',
      blurb: 'A row of pendulums swinging out of phase, amplitude riding each band.',
      init(s) {
        s.n = 24
        s.ranges = V.bandRanges(s.n)
        s.v = new Float32Array(s.n)
        s.pk = new Float32Array(s.n).fill(0.09)
        s.ph = new Float32Array(s.n)
        for (let i = 0; i < s.n; i++) s.ph[i] = i * 0.35
      },
      draw(ctx, W, H, d, o, s) {
        const minD = Math.min(W, H)
        const k = Math.min(1, V.rate(o))
        for (let i = 0; i < s.n; i++) {
          s.v[i] += (V.adaptive(s.pk, i, V.bandValue(d.freq, s.ranges[i]), o) - s.v[i]) * k
        }
        const slot = W / s.n
        const rodLen = H * 0.4
        const top = H * 0.08
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          s.ph[i] += 0.05 + i * 0.0025
          const swing = (0.15 + v * 0.55) * Math.sin(s.ph[i])
          const x0 = (i + 0.5) * slot
          const x1 = x0 + Math.sin(swing) * rodLen
          const y1 = top + Math.cos(swing) * rodLen
          ctx.beginPath()
          ctx.moveTo(x0, top)
          ctx.lineTo(x1, y1)
          ctx.strokeStyle = 'rgba(255,255,255,0.16)'
          ctx.lineWidth = Math.max(1, minD * 0.0022)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(x1, y1, Math.max(1.6 * o.dpr, minD * (0.006 + v * 0.014)), 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.4 + v * 0.6)
          ctx.fill()
        }
      }
    },

    {
      id: 'cx-isobars',
      name: 'Isobars',
      family: 'Bars',
      blurb: 'Layered translucent bar silhouettes at different smoothing speeds, like stacked contour maps.',
      init(s) {
        s.n = 32
        s.ranges = V.bandRanges(s.n)
        s.layers = 4
        s.v = new Float32Array(s.n * s.layers)
        s.pk = new Float32Array(s.n).fill(0.09)
      },
      draw(ctx, W, H, d, o, s) {
        const base = H * 0.94
        const slot = W / s.n
        const rawRate = V.rate(o)
        for (let L = 0; L < s.layers; L++) {
          const k = Math.min(1, rawRate * (0.35 + L * 0.35))
          const off = L * s.n
          for (let i = 0; i < s.n; i++) {
            const target = V.adaptive(s.pk, i, V.bandValue(d.freq, s.ranges[i]), o)
            s.v[off + i] += (target - s.v[off + i]) * k
          }
        }
        for (let L = s.layers - 1; L >= 0; L--) {
          const off = L * s.n
          const t = L / (s.layers - 1)
          ctx.beginPath()
          ctx.moveTo(0, base)
          for (let i = 0; i < s.n; i++) {
            const v = V.clamp(s.v[off + i], 0, 1)
            const h = v * H * (0.5 + t * 0.2)
            ctx.lineTo(i * slot, base - h)
            ctx.lineTo((i + 1) * slot, base - h)
          }
          ctx.lineTo(W, base)
          ctx.closePath()
          ctx.fillStyle = V.paletteAt(o.palette, t, 0.14 + (1 - t) * 0.35)
          ctx.fill()
          ctx.strokeStyle = V.paletteAt(o.palette, t, 0.4 + (1 - t) * 0.4)
          ctx.lineWidth = Math.max(1, H * 0.0025)
          ctx.stroke()
        }
      }
    },

    /* ======================================================== CIRCULAR ==== */
    {
      id: 'cx-vinyl',
      name: 'Vinyl',
      family: 'Circular',
      blurb: 'A spinning record with grooves that wobble under the music and a tonearm riding the surface.',
      init(s) {
        bands(s, 48)
        s.rot = 0
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.6)
        const cx = W * 0.46
        const cy = H / 2
        const minD = Math.min(W, H)
        const R = minD * 0.4
        s.rot += 0.008 + d.level * 0.02

        ctx.beginPath()
        ctx.arc(cx, cy, R, 0, TAU)
        ctx.fillStyle = 'rgba(14,14,18,0.9)'
        ctx.fill()

        const rings = 30
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(s.rot)
        for (let g = 1; g < rings; g++) {
          const t = g / rings
          const b = s.v[Math.floor(t * (s.n - 1))]
          const r = R * (0.22 + t * 0.74) * (1 + b * 0.01)
          ctx.beginPath()
          ctx.arc(0, 0, r, 0, TAU)
          ctx.strokeStyle = `rgba(255,255,255,${g % 3 === 0 ? 0.06 : 0.03})`
          ctx.lineWidth = Math.max(0.6, minD * 0.0009)
          ctx.stroke()
        }
        ctx.restore()

        const labelR = R * 0.2
        const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, labelR)
        g2.addColorStop(0, V.paletteAt(o.palette, 0.5, 0.9))
        g2.addColorStop(1, V.paletteAt(o.palette, 0.5, 0.55))
        ctx.beginPath()
        ctx.arc(cx, cy, labelR, 0, TAU)
        ctx.fillStyle = g2
        ctx.fill()
        ctx.beginPath()
        ctx.arc(cx, cy, minD * 0.012, 0, TAU)
        ctx.fillStyle = 'rgba(10,10,12,0.9)'
        ctx.fill()

        const pivotX = cx + R * 1.25
        const pivotY = cy - R * 1.05
        const jitter = Math.sin(d.t * 0.01) * 0.02 * d.level
        const tipAngle = Math.PI * 0.62 + jitter
        const armLen = minD * 0.42
        const tipX = pivotX + Math.cos(tipAngle) * armLen
        const tipY = pivotY + Math.sin(tipAngle) * armLen
        ctx.beginPath()
        ctx.moveTo(pivotX, pivotY)
        ctx.lineTo(tipX, tipY)
        ctx.strokeStyle = 'rgba(220,220,225,0.55)'
        ctx.lineWidth = Math.max(1.4, minD * 0.005)
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(pivotX, pivotY, minD * 0.012, 0, TAU)
        ctx.fillStyle = 'rgba(220,220,225,0.7)'
        ctx.fill()
      }
    },

    {
      id: 'cx-tape-reels',
      name: 'Tape Reels',
      family: 'Circular',
      blurb: 'Twin open reels spinning to the bass and treble, tape looping between them.',
      init(s) {
        bands(s, 8)
        s.rot = 0
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.6)
        const minD = Math.min(W, H)
        const cy = H / 2
        const R = minD * 0.2
        const cx1 = W * 0.3
        const cx2 = W * 0.7
        s.rot += 0.01 + d.level * 0.05
        const wound1 = 0.4 + d.bass * 0.35
        const wound2 = 0.75 - d.treble * 0.35

        ctx.beginPath()
        ctx.moveTo(cx1 + R, cy - R * 0.15)
        ctx.lineTo(cx2 - R, cy - R * 0.15)
        ctx.moveTo(cx1 + R, cy + R * 0.15)
        ctx.lineTo(cx2 - R, cy + R * 0.15)
        ctx.strokeStyle = 'rgba(180,140,90,0.4)'
        ctx.lineWidth = Math.max(1, minD * 0.003)
        ctx.stroke()

        const reel = (cx, wound, tint) => {
          ctx.beginPath()
          ctx.arc(cx, cy, R, 0, TAU)
          ctx.fillStyle = 'rgba(20,20,24,0.9)'
          ctx.fill()
          ctx.beginPath()
          ctx.arc(cx, cy, R * wound, 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, tint, 0.55)
          ctx.fill()
          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(s.rot * (tint > 0.5 ? -1 : 1))
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * TAU
            ctx.beginPath()
            ctx.moveTo(0, 0)
            ctx.lineTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9)
            ctx.strokeStyle = 'rgba(255,255,255,0.18)'
            ctx.lineWidth = Math.max(1, minD * 0.004)
            ctx.stroke()
          }
          ctx.restore()
          ctx.beginPath()
          ctx.arc(cx, cy, R * 0.08, 0, TAU)
          ctx.fillStyle = 'rgba(230,230,235,0.8)'
          ctx.fill()
        }
        reel(cx1, wound1, 0.2)
        reel(cx2, wound2, 0.8)
      }
    },

    {
      id: 'cx-radar',
      name: 'Radar Contacts',
      family: 'Circular',
      blurb: 'A rotating scan wedge with persistent contacts that brighten each pass, classic radar-screen style.',
      init(s) {
        bands(s, 48)
        s.ang = 0
        s.contact = new Float32Array(s.n)
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const R = minD * 0.42
        s.ang = (s.ang + 0.018) % TAU

        for (let r = 1; r <= 4; r++) {
          ctx.beginPath()
          ctx.arc(cx, cy, R * (r / 4), 0, TAU)
          ctx.strokeStyle = V.rgba(o.accent, 0.08)
          ctx.lineWidth = Math.max(1, minD * 0.0018)
          ctx.stroke()
        }

        const wedgeW = 0.28
        for (let k = 0; k < 22; k++) {
          const t = k / 22
          const a = s.ang - t * wedgeW
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.arc(cx, cy, R, a - 0.01, a + 0.01)
          ctx.closePath()
          ctx.fillStyle = V.rgba(o.accent, 0.16 * (1 - t))
          ctx.fill()
        }

        for (let i = 0; i < s.n; i++) {
          const a = (i / s.n) * TAU
          const da = Math.abs(((a - s.ang + Math.PI * 3) % TAU) - Math.PI)
          s.contact[i] *= 0.985
          if (da < 0.05) s.contact[i] = Math.max(s.contact[i], V.clamp(s.v[i], 0, 1))
        }

        for (let i = 0; i < s.n; i++) {
          const c = s.contact[i]
          if (c < 0.04) continue
          const a = (i / s.n) * TAU
          const r = R * (0.25 + ((i % 5) / 5) * 0.7)
          ctx.beginPath()
          ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(1.4 * o.dpr, minD * 0.006 * c), 0, TAU)
          ctx.fillStyle = V.rgba(o.accent, 0.3 + c * 0.7)
          ctx.fill()
        }

        ctx.beginPath()
        ctx.arc(cx, cy, R, 0, TAU)
        ctx.strokeStyle = V.rgba(o.accent, 0.25)
        ctx.lineWidth = Math.max(1, minD * 0.002)
        ctx.stroke()
      }
    },

    {
      id: 'cx-spirograph',
      name: 'Spirograph',
      family: 'Circular',
      blurb: 'A hypotrochoid pen tracing loops that slowly redraw themselves as the ratios drift with the mix.',
      trails: true,
      init(s) {
        s.t = 0
        s.r = 0.35
        s.dd = 0.6
      },
      draw(ctx, W, H, d, o, s) {
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const scale = minD * 0.32

        s.r += (0.28 + d.mid * 0.22 - s.r) * 0.008
        s.dd += (0.45 + d.treble * 0.5 - s.dd) * 0.008

        const steps = 10
        const dt = 0.012 + d.level * 0.02 * o.sensitivity
        ctx.beginPath()
        let first = true
        for (let k = 0; k < steps; k++) {
          s.t += dt
          const R = 1
          const r = s.r
          const dd = s.dd
          const x = (R - r) * Math.cos(s.t) + dd * r * Math.cos(((R - r) / r) * s.t)
          const y = (R - r) * Math.sin(s.t) - dd * r * Math.sin(((R - r) / r) * s.t)
          const px = cx + x * scale
          const py = cy + y * scale
          if (first) {
            ctx.moveTo(px, py)
            first = false
          } else ctx.lineTo(px, py)
        }
        ctx.strokeStyle = V.paletteAt(o.palette, (Math.sin(s.t * 0.3) + 1) / 2, 0.85)
        ctx.lineWidth = Math.max(1.2, minD * 0.003)
        ctx.shadowColor = V.rgba(o.accent, 0.4)
        ctx.shadowBlur = minD * 0.01
        ctx.stroke()
        ctx.shadowBlur = 0
      }
    },

    {
      id: 'cx-phyllotaxis',
      name: 'Phyllotaxis',
      family: 'Circular',
      blurb: 'A sunflower seed spiral built on the golden angle, each seed pulsing with its own band.',
      init(s) {
        s.n = 34
        s.ranges = V.bandRanges(s.n)
        s.v = new Float32Array(s.n)
        s.pk = new Float32Array(s.n).fill(0.09)
        s.count = 220
        s.golden = Math.PI * (3 - Math.sqrt(5))
      },
      draw(ctx, W, H, d, o, s) {
        const k = Math.min(1, V.rate(o))
        for (let i = 0; i < s.n; i++) {
          s.v[i] += (V.adaptive(s.pk, i, V.bandValue(d.freq, s.ranges[i]), o) - s.v[i]) * k
        }
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const c = minD * 0.028 * (1 + d.level * 0.15)
        const rot = d.t * 0.00006
        for (let i = 0; i < s.count; i++) {
          const a = i * s.golden + rot
          const r = c * Math.sqrt(i)
          const b = i % s.n
          const v = V.clamp(s.v[b], 0, 1)
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          const sz = minD * (0.0026 + v * 0.008)
          ctx.beginPath()
          ctx.arc(x, y, sz, 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, b / (s.n - 1), 0.25 + v * 0.7)
          ctx.fill()
        }
      }
    },

    /* ============================================================ GRID ==== */
    {
      id: 'cx-voronoi',
      name: 'Voronoi Cells',
      family: 'Grid',
      blurb: 'Cells claimed by drifting seed points, each one keyed to a band of the spectrum.',
      init(s) {
        bands(s, 18)
        s.seeds = []
        for (let i = 0; i < 18; i++) {
          s.seeds.push({ x: rnd(i), y: rnd(i + 50), vx: (rnd(i + 3) - 0.5) * 0.0006, vy: (rnd(i + 7) - 0.5) * 0.0006 })
        }
        s.cols = 26
        s.rows = 16
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.6)
        const cw = W / s.cols
        const ch = H / s.rows
        for (const sd of s.seeds) {
          sd.x += sd.vx
          sd.y += sd.vy
          if (sd.x < 0 || sd.x > 1) sd.vx *= -1
          if (sd.y < 0 || sd.y > 1) sd.vy *= -1
          sd.x = V.clamp(sd.x, 0, 1)
          sd.y = V.clamp(sd.y, 0, 1)
        }
        for (let i = 0; i < s.cols; i++) {
          for (let j = 0; j < s.rows; j++) {
            const px = (i + 0.5) / s.cols
            const py = (j + 0.5) / s.rows
            let best = 0
            let bestD = Infinity
            for (let kk = 0; kk < s.seeds.length; kk++) {
              const sd = s.seeds[kk]
              const dx = (px - sd.x) * W
              const dy = (py - sd.y) * H
              const dist = dx * dx + dy * dy
              if (dist < bestD) {
                bestD = dist
                best = kk
              }
            }
            const v = V.clamp(s.v[best % s.n], 0, 1)
            ctx.fillStyle = V.paletteAt(o.palette, best / (s.seeds.length - 1), 0.1 + v * 0.75)
            ctx.fillRect(i * cw, j * ch, cw + 1, ch + 1)
          }
        }
      }
    },

    {
      id: 'cx-isolines',
      name: 'Isolines',
      family: 'Grid',
      blurb: 'A topographic contour map built by slicing the spectrum field at several elevations.',
      init: (s) => bands(s, 40),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.7)
        const minD = Math.min(W, H)
        const cy = H / 2
        const cols = s.n
        const levels = 6
        for (let L = levels; L >= 1; L--) {
          const th = L / (levels + 1)
          ctx.beginPath()
          for (let i = 0; i <= cols; i++) {
            const v = V.clamp(s.v[Math.min(cols - 1, i)], 0, 1)
            const off = Math.sqrt(Math.max(0, v - th)) * H * 0.5
            const x = (i / cols) * W
            const y = cy - off
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          for (let i = cols; i >= 0; i--) {
            const v = V.clamp(s.v[Math.min(cols - 1, i)], 0, 1)
            const off = Math.sqrt(Math.max(0, v - th)) * H * 0.5
            const x = (i / cols) * W
            const y = cy + off
            ctx.lineTo(x, y)
          }
          ctx.closePath()
          ctx.fillStyle = V.paletteAt(o.palette, L / levels, 0.1 + (1 - L / levels) * 0.12)
          ctx.fill()
          ctx.strokeStyle = V.paletteAt(o.palette, L / levels, 0.3 + (1 - L / levels) * 0.35)
          ctx.lineWidth = Math.max(1, minD * 0.0022)
          ctx.stroke()
        }
      }
    },

    {
      id: 'cx-stained-glass',
      name: 'Stained Glass',
      family: 'Grid',
      blurb: 'Leaded glass panels backlit from within, each jewel-toned cell keyed to a band.',
      init(s) {
        bands(s, 24)
        s.cols = 6
        s.rows = 4
        s.jit = []
        for (let i = 0; i < (s.cols + 1) * (s.rows + 1); i++) {
          s.jit.push({ x: (rnd(i) - 0.5) * 0.4, y: (rnd(i + 40) - 0.5) * 0.4 })
        }
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.5)
        const cw = W / s.cols
        const ch = H / s.rows
        const minD = Math.min(W, H)
        const pt = (i, j) => {
          const idx = j * (s.cols + 1) + i
          const jj = s.jit[idx]
          return { x: i * cw + jj.x * cw, y: j * ch + jj.y * ch }
        }
        let bi = 0
        for (let i = 0; i < s.cols; i++) {
          for (let j = 0; j < s.rows; j++) {
            const p0 = pt(i, j)
            const p1 = pt(i + 1, j)
            const p2 = pt(i + 1, j + 1)
            const p3 = pt(i, j + 1)
            const b = bi++ % s.n
            const v = V.clamp(s.v[b], 0, 1)
            ctx.beginPath()
            ctx.moveTo(p0.x, p0.y)
            ctx.lineTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.lineTo(p3.x, p3.y)
            ctx.closePath()
            ctx.fillStyle = V.paletteAt(o.palette, b / (s.n - 1), 0.28 + v * 0.6)
            ctx.fill()
            ctx.globalCompositeOperation = 'lighter'
            ctx.fillStyle = V.rgba(o.accent, v * 0.12)
            ctx.fill()
            ctx.globalCompositeOperation = 'source-over'
            ctx.strokeStyle = 'rgba(8,8,10,0.85)'
            ctx.lineWidth = Math.max(1.4, minD * 0.006)
            ctx.stroke()
          }
        }
      }
    },

    {
      id: 'cx-circuit',
      name: 'Circuit Traces',
      family: 'Grid',
      blurb: 'A board of right-angle traces with pulses of light travelling to the beat.',
      init(s) {
        bands(s, 16)
        s.cols = 12
        s.rows = 8
        s.segs = []
        let i = 0
        for (let r = 0; r < s.rows; r++) {
          for (let c = 0; c < s.cols - 1; c++) {
            if (rnd(i++) < 0.35) s.segs.push({ x0: c, y0: r, x1: c + 1, y1: r })
          }
        }
        for (let c = 0; c < s.cols; c++) {
          for (let r = 0; r < s.rows - 1; r++) {
            if (rnd(i++) < 0.3) s.segs.push({ x0: c, y0: r, x1: c, y1: r + 1 })
          }
        }
        s.pulses = []
        s.armed = true
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.6)
        const cw = W / s.cols
        const ch = H / s.rows
        const minD = Math.min(W, H)

        ctx.lineWidth = Math.max(1, minD * 0.0018)
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'
        for (const seg of s.segs) {
          ctx.beginPath()
          ctx.moveTo(seg.x0 * cw, seg.y0 * ch)
          ctx.lineTo(seg.x1 * cw, seg.y1 * ch)
          ctx.stroke()
        }

        if ((d.beat > 0.5 && s.armed) || (s.pulses.length === 0 && Math.random() < 0.01)) {
          const seg = s.segs[Math.floor(Math.random() * s.segs.length)]
          if (seg) s.pulses.push({ seg, t: 0, band: Math.floor(Math.random() * s.n) })
          s.armed = false
        }
        if (d.beat < 0.2) s.armed = true

        for (let i = s.pulses.length - 1; i >= 0; i--) {
          const p = s.pulses[i]
          p.t += 0.03
          if (p.t >= 1) {
            s.pulses.splice(i, 1)
            continue
          }
          const seg = p.seg
          const x = (seg.x0 + (seg.x1 - seg.x0) * p.t) * cw
          const y = (seg.y0 + (seg.y1 - seg.y0) * p.t) * ch
          const v = V.clamp(s.v[p.band], 0, 1)
          ctx.beginPath()
          ctx.arc(x, y, Math.max(2 * o.dpr, minD * (0.006 + v * 0.008)), 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, p.band / (s.n - 1), 0.9)
          ctx.shadowColor = V.rgba(o.accent, 0.7)
          ctx.shadowBlur = minD * 0.02
          ctx.fill()
          ctx.shadowBlur = 0
        }

        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        for (let c = 0; c <= s.cols; c++) {
          for (let r = 0; r <= s.rows; r++) {
            ctx.beginPath()
            ctx.arc(c * cw, r * ch, Math.max(1 * o.dpr, minD * 0.0022), 0, TAU)
            ctx.fill()
          }
        }
      }
    },

    {
      id: 'cx-chladni',
      name: 'Chladni Plate',
      family: 'Grid',
      blurb: 'Sand grains migrating to the nodal lines of a standing-wave plate, tuned by bass and treble.',
      init(s) {
        s.n = 260
        s.gx = new Float32Array(s.n)
        s.gy = new Float32Array(s.n)
        for (let i = 0; i < s.n; i++) {
          s.gx[i] = rnd(i)
          s.gy[i] = rnd(i + 90)
        }
        s.m = 3
        s.nn = 4
      },
      draw(ctx, W, H, d, o, s) {
        const minD = Math.min(W, H)
        const side = minD * 0.82
        const ox = W / 2 - side / 2
        const oy = H / 2 - side / 2
        s.m += (3 + d.bass * 4 - s.m) * 0.01
        s.nn += (4 + d.treble * 5 - s.nn) * 0.01
        const m = s.m
        const n = s.nn
        const field = (x, y) =>
          Math.sin(n * Math.PI * x) * Math.sin(m * Math.PI * y) - Math.sin(m * Math.PI * x) * Math.sin(n * Math.PI * y)
        const step = 0.01 * (0.6 + d.level * 1.2 * o.sensitivity)
        const eps = 0.01
        for (let i = 0; i < s.n; i++) {
          const x = s.gx[i]
          const y = s.gy[i]
          const f = field(x, y)
          const fx = (field(x + eps, y) - f) / eps
          const fy = (field(x, y + eps) - f) / eps
          const grad = Math.sqrt(fx * fx + fy * fy) + 1e-4
          const sign = f >= 0 ? 1 : -1
          s.gx[i] = V.clamp(x - (fx / grad) * sign * step + (Math.random() - 0.5) * 0.004, 0, 1)
          s.gy[i] = V.clamp(y - (fy / grad) * sign * step + (Math.random() - 0.5) * 0.004, 0, 1)
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'
        ctx.strokeRect(ox, oy, side, side)
        for (let i = 0; i < s.n; i++) {
          const px = ox + s.gx[i] * side
          const py = oy + s.gy[i] * side
          ctx.beginPath()
          ctx.arc(px, py, Math.max(0.9 * o.dpr, minD * 0.0018), 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, (s.gx[i] + s.gy[i]) / 2, 0.55)
          ctx.fill()
        }
      }
    },

    /* ======================================================== PARTICLE ==== */
    {
      id: 'cx-boids',
      name: 'Boid Flock',
      family: 'Particle',
      blurb: 'A small flock steering by separation, alignment and cohesion, scattering on the beat.',
      init(s) {
        s.n = 55
        s.x = new Float32Array(s.n)
        s.y = new Float32Array(s.n)
        s.vx = new Float32Array(s.n)
        s.vy = new Float32Array(s.n)
        for (let i = 0; i < s.n; i++) {
          s.x[i] = rnd(i)
          s.y[i] = rnd(i + 30)
          s.vx[i] = (rnd(i + 5) - 0.5) * 0.002
          s.vy[i] = (rnd(i + 9) - 0.5) * 0.002
        }
      },
      draw(ctx, W, H, d, o, s) {
        const n = s.n
        const perc = 0.14
        const scatter = d.beat * 0.02
        const tstep = Math.floor(d.t)
        for (let i = 0; i < n; i++) {
          let ax = 0
          let ay = 0
          let cx = 0
          let cy = 0
          let sx = 0
          let sy = 0
          let cnt = 0
          for (let j = 0; j < n; j++) {
            if (i === j) continue
            const dx = s.x[j] - s.x[i]
            const dy = s.y[j] - s.y[i]
            const d2 = dx * dx + dy * dy
            if (d2 < perc * perc) {
              cnt++
              ax += s.vx[j]
              ay += s.vy[j]
              cx += s.x[j]
              cy += s.y[j]
              if (d2 < perc * 0.4 * (perc * 0.4)) {
                sx -= dx
                sy -= dy
              }
            }
          }
          if (cnt > 0) {
            s.vx[i] += (ax / cnt - s.vx[i]) * 0.02 + (cx / cnt - s.x[i]) * 0.0015 + sx * 0.002
            s.vy[i] += (ay / cnt - s.vy[i]) * 0.02 + (cy / cnt - s.y[i]) * 0.0015 + sy * 0.002
          }
          s.vx[i] += (rnd(i + tstep) - 0.5) * scatter
          s.vy[i] += (rnd(i + tstep + 7) - 0.5) * scatter
          s.vx[i] += (0.5 - s.x[i]) * 0.0004
          s.vy[i] += (0.5 - s.y[i]) * 0.0004
          const sp = Math.sqrt(s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i])
          const maxSp = 0.006
          if (sp > maxSp) {
            s.vx[i] *= maxSp / sp
            s.vy[i] *= maxSp / sp
          }
          s.x[i] += s.vx[i]
          s.y[i] += s.vy[i]
        }
        const minD = Math.min(W, H)
        for (let i = 0; i < n; i++) {
          const a = Math.atan2(s.vy[i], s.vx[i])
          const x = s.x[i] * W
          const y = s.y[i] * H
          const len = minD * 0.014
          ctx.save()
          ctx.translate(x, y)
          ctx.rotate(a)
          ctx.beginPath()
          ctx.moveTo(len, 0)
          ctx.lineTo(-len * 0.6, len * 0.4)
          ctx.lineTo(-len * 0.6, -len * 0.4)
          ctx.closePath()
          ctx.fillStyle = V.paletteAt(o.palette, i / (n - 1), 0.85)
          ctx.fill()
          ctx.restore()
        }
      }
    },

    {
      id: 'cx-smoke',
      name: 'Smoke Plume',
      family: 'Particle',
      blurb: 'A soft plume rising from the floor, its turbulence stirred up by the treble.',
      init(s) {
        s.p = []
      },
      draw(ctx, W, H, d, o, s) {
        const minD = Math.min(W, H)
        const spawnRate = 1 + Math.floor(d.level * 4 * o.sensitivity)
        if (s.p.length < 260) {
          for (let i = 0; i < spawnRate; i++) {
            s.p.push({ x: 0.5 + (rnd(s.p.length + i) - 0.5) * 0.06, y: 1.02, r: 0.01, life: 1, ph: rnd(s.p.length + i + 9) * TAU })
          }
        }
        const turb = 0.4 + d.treble * 1.6
        for (let i = s.p.length - 1; i >= 0; i--) {
          const p = s.p[i]
          p.y -= 0.0016 + p.r * 0.01
          p.x += Math.sin(p.ph + p.y * 8) * 0.0015 * turb
          p.r += 0.0009
          p.life -= 0.0055
          if (p.life <= 0 || p.y < -0.1) {
            s.p.splice(i, 1)
            continue
          }
          const x = p.x * W
          const y = p.y * H
          const rad = p.r * minD
          const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, rad))
          g.addColorStop(0, V.paletteAt(o.palette, 0.5, 0.16 * p.life))
          g.addColorStop(1, V.paletteAt(o.palette, 0.5, 0))
          ctx.beginPath()
          ctx.arc(x, y, Math.max(1, rad), 0, TAU)
          ctx.fillStyle = g
          ctx.fill()
        }
      }
    },

    {
      id: 'cx-lightning',
      name: 'Lightning',
      family: 'Particle',
      blurb: 'Branching bolts fired from the centre on every kick, with faint stray arcs between hits.',
      trails: true,
      init(s) {
        s.bolts = []
        s.armed = true
      },
      draw(ctx, W, H, d, o, s) {
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const spawn = (strength) => {
          const count = 3 + Math.floor(strength * 4)
          for (let b = 0; b < count; b++) {
            const pts = [{ x: cx, y: cy }]
            let x = cx
            let y = cy
            let a = Math.random() * TAU
            const len = minD * (0.25 + strength * 0.2)
            const segs = 10
            for (let i = 0; i < segs; i++) {
              a += (Math.random() - 0.5) * 0.9
              x += Math.cos(a) * (len / segs)
              y += Math.sin(a) * (len / segs)
              pts.push({ x, y })
            }
            s.bolts.push({ pts, life: 1 })
          }
        }
        if (d.beat > 0.5 && s.armed) {
          spawn(d.beat)
          s.armed = false
        }
        if (d.beat < 0.2) s.armed = true
        if (Math.random() < 0.01) spawn(0.15)

        for (let i = s.bolts.length - 1; i >= 0; i--) {
          const b = s.bolts[i]
          b.life -= 0.06
          if (b.life <= 0) {
            s.bolts.splice(i, 1)
            continue
          }
          ctx.beginPath()
          ctx.moveTo(b.pts[0].x, b.pts[0].y)
          for (let p = 1; p < b.pts.length; p++) ctx.lineTo(b.pts[p].x, b.pts[p].y)
          ctx.strokeStyle = V.rgba(o.accent, V.clamp(b.life * 1.2, 0, 1))
          ctx.lineWidth = Math.max(1, minD * 0.0035 * b.life)
          ctx.shadowColor = V.rgba(o.accent, 0.7)
          ctx.shadowBlur = minD * 0.012
          ctx.stroke()
          ctx.shadowBlur = 0
        }
      }
    },

    {
      id: 'cx-bounce',
      name: 'Bouncing Balls',
      family: 'Particle',
      blurb: 'One ball per band, bouncing higher the louder its slice of the spectrum gets.',
      init(s) {
        s.n = 18
        s.ranges = V.bandRanges(s.n)
        s.v = new Float32Array(s.n)
        s.pk = new Float32Array(s.n).fill(0.09)
        s.y = new Float32Array(s.n)
        s.vy = new Float32Array(s.n)
      },
      draw(ctx, W, H, d, o, s) {
        const k = Math.min(1, V.rate(o))
        for (let i = 0; i < s.n; i++) {
          s.v[i] += (V.adaptive(s.pk, i, V.bandValue(d.freq, s.ranges[i]), o) - s.v[i]) * k
        }
        const minD = Math.min(W, H)
        const floor = H * 0.92
        const g = minD * 0.0011
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          s.vy[i] += g
          s.y[i] += s.vy[i]
          const r = minD * (0.014 + v * 0.01)
          if (s.y[i] + r >= floor) {
            s.y[i] = floor - r
            s.vy[i] = -Math.sqrt(2 * g * minD * (0.05 + v * 0.34))
          }
          const x = ((i + 0.5) / s.n) * W
          const shrink = V.clamp(1 - (floor - s.y[i]) / (minD * 0.3), 0.15, 1)
          ctx.beginPath()
          ctx.ellipse(x, floor + r * 0.3, r * shrink, r * 0.28 * shrink, 0, 0, TAU)
          ctx.fillStyle = 'rgba(0,0,0,0.25)'
          ctx.fill()
          ctx.beginPath()
          ctx.arc(x, s.y[i], r, 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.5 + v * 0.5)
          ctx.fill()
        }
      }
    },

    {
      id: 'cx-pond',
      name: 'Pond Ripples',
      family: 'Particle',
      blurb: 'Rain falling in perspective onto a pond floor, each drop leaving a ring that grows and fades.',
      init(s) {
        s.drops = []
        s.rings = []
      },
      draw(ctx, W, H, d, o, s) {
        const minD = Math.min(W, H)
        const horizon = H * 0.42
        const rate = 1 + Math.floor(d.level * 5 * o.sensitivity)
        const tstep = Math.floor(d.t)
        if (s.drops.length < 90) {
          for (let i = 0; i < rate; i++) {
            s.drops.push({ x: rnd(s.drops.length + tstep + i), y: 0, sp: 0.4 + rnd(i + 3) * 0.8 })
          }
        }
        for (let i = s.drops.length - 1; i >= 0; i--) {
          const p = s.drops[i]
          p.y += 0.02 * p.sp
          if (p.y >= 1) {
            s.rings.push({ x: p.x, life: 1 })
            s.drops.splice(i, 1)
            continue
          }
          const py = horizon + p.y * p.y * (H - horizon)
          const px = 0.5 * W + (p.x - 0.5) * W * (0.3 + p.y * 0.7)
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(px, py - 6 * o.dpr * (0.3 + p.y))
          ctx.strokeStyle = V.rgba(o.accent, 0.5)
          ctx.lineWidth = Math.max(1, o.dpr)
          ctx.stroke()
        }
        if (s.rings.length > 60) s.rings.splice(0, s.rings.length - 60)
        for (let i = s.rings.length - 1; i >= 0; i--) {
          const r = s.rings[i]
          r.life -= 0.02
          if (r.life <= 0) {
            s.rings.splice(i, 1)
            continue
          }
          const px = 0.5 * W + (r.x - 0.5) * W
          const py = H
          const rad = (1 - r.life) * minD * 0.16
          ctx.beginPath()
          ctx.ellipse(px, py - minD * 0.02, rad, rad * 0.28, 0, 0, TAU)
          ctx.strokeStyle = V.paletteAt(o.palette, r.x, r.life * 0.6)
          ctx.lineWidth = Math.max(1, minD * 0.0025 * r.life)
          ctx.stroke()
        }
      }
    },

    /* ======================================================== ABSTRACT ==== */
    {
      id: 'cx-dna',
      name: 'DNA Helix',
      family: 'Abstract',
      blurb: 'A double helix turning end over end, its rungs lighting up with the spectrum.',
      init: (s) => bands(s, 20),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.7)
        const minD = Math.min(W, H)
        const cx = W / 2
        const rungs = 20
        const spacing = H / (rungs + 1)
        const amp = minD * 0.16
        const rot = d.t * 0.0012
        for (let i = 0; i < rungs; i++) {
          const y = spacing * (i + 1)
          const ph = (i / rungs) * Math.PI * 2.4 + rot
          const x1 = cx + Math.cos(ph) * amp
          const x2 = cx + Math.cos(ph + Math.PI) * amp
          const z1 = Math.sin(ph)
          const z2 = Math.sin(ph + Math.PI)
          const v = V.clamp(s.v[i % s.n], 0, 1)

          ctx.beginPath()
          ctx.moveTo(x1, y)
          ctx.lineTo(x2, y)
          ctx.strokeStyle = V.paletteAt(o.palette, i / (rungs - 1), 0.15 + v * 0.55)
          ctx.lineWidth = Math.max(1, minD * (0.0022 + v * 0.003))
          ctx.stroke()

          const node = (x, z) => {
            const sz = minD * (0.006 + (z + 1) * 0.004 + v * 0.006)
            ctx.beginPath()
            ctx.arc(x, y, sz, 0, TAU)
            ctx.fillStyle = V.paletteAt(o.palette, (z + 1) / 2, 0.5 + v * 0.5)
            ctx.fill()
          }
          node(x1, z1)
          node(x2, z2)
        }
      }
    },

    {
      id: 'cx-metaballs',
      name: 'Metaballs',
      family: 'Abstract',
      blurb: 'A handful of soft blobs that stretch and merge into each other with the low end.',
      init(s) {
        s.n = 5
        s.a = new Float32Array(s.n)
        s.r = new Float32Array(s.n)
        for (let i = 0; i < s.n; i++) {
          s.a[i] = (i / s.n) * TAU
          s.r[i] = 0.16 + rnd(i) * 0.08
        }
      },
      draw(ctx, W, H, d, o, s) {
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const t = d.t / 1000
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < s.n; i++) {
          const wob = 0.5 + i * 0.13
          const rr = (s.r[i] + Math.sin(t * wob) * 0.03) * (1 + d.bass * 0.25)
          const a = s.a[i] + t * (0.06 + i * 0.01)
          const x = cx + Math.cos(a) * minD * 0.2
          const y = cy + Math.sin(a * 1.3) * minD * 0.16
          const rad = minD * rr
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
          g.addColorStop(0, V.paletteAt(o.palette, i / (s.n - 1), 0.85))
          g.addColorStop(0.6, V.paletteAt(o.palette, i / (s.n - 1), 0.4))
          g.addColorStop(1, V.paletteAt(o.palette, i / (s.n - 1), 0))
          ctx.beginPath()
          ctx.arc(x, y, rad, 0, TAU)
          ctx.fillStyle = g
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    },

    {
      id: 'cx-fractal-tree',
      name: 'Fractal Tree',
      family: 'Abstract',
      blurb: 'A branching tree that grows leaf-brightness from the spectrum and sways in a slow wind.',
      init: (s) => bands(s, 16),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.6)
        const minD = Math.min(W, H)
        const sway = Math.sin(d.t * 0.0007) * 0.08 + (d.bass - 0.3) * 0.1
        const spread = 0.5 + d.mid * 0.35
        const shrink = 0.72 + d.treble * 0.06
        const maxDepth = 8
        let leafIdx = 0
        ctx.lineCap = 'round'
        function branch(x, y, len, angle, depth) {
          const x2 = x + Math.cos(angle) * len
          const y2 = y + Math.sin(angle) * len
          const t = depth / maxDepth
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x2, y2)
          ctx.strokeStyle = V.paletteAt(o.palette, t, 0.3 + (1 - t) * 0.5)
          ctx.lineWidth = Math.max(1, minD * 0.014 * t + o.dpr)
          ctx.stroke()
          if (depth <= 0) {
            const b = leafIdx++ % s.n
            const v = V.clamp(s.v[b], 0, 1)
            ctx.beginPath()
            ctx.arc(x2, y2, minD * (0.004 + v * 0.012), 0, TAU)
            ctx.fillStyle = V.paletteAt(o.palette, b / (s.n - 1), 0.4 + v * 0.6)
            ctx.fill()
            return
          }
          branch(x2, y2, len * shrink, angle - spread * 0.5 + sway, depth - 1)
          branch(x2, y2, len * shrink, angle + spread * 0.5 + sway, depth - 1)
        }
        branch(W / 2, H * 0.94, minD * 0.16, -Math.PI / 2, maxDepth)
      }
    },

    {
      id: 'cx-field-lines',
      name: 'Field Lines',
      family: 'Abstract',
      blurb: 'Magnetic field lines arcing between two poles that push apart on the kick.',
      init: (s) => bands(s, 14),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.6)
        const minD = Math.min(W, H)
        const cy = H / 2
        const sep = minD * (0.14 + d.bass * 0.12)
        const p1x = W / 2 - sep
        const p2x = W / 2 + sep
        const lines = 14
        for (let i = 0; i < lines; i++) {
          const t = (i + 0.5) / lines
          const v = V.clamp(s.v[i % s.n], 0, 1)
          const bulge = minD * (0.1 + t * 0.42) * (1 + v * 0.25)
          const midX = (p1x + p2x) / 2
          const side = i % 2 === 0 ? -1 : 1
          const cyp = cy + side * bulge
          ctx.beginPath()
          ctx.moveTo(p1x, cy)
          ctx.quadraticCurveTo(midX, cyp, p2x, cy)
          ctx.strokeStyle = V.paletteAt(o.palette, t, 0.15 + v * 0.55)
          ctx.lineWidth = Math.max(1, minD * 0.002)
          ctx.stroke()
        }
        for (const px of [p1x, p2x]) {
          const g = ctx.createRadialGradient(px, cy, 0, px, cy, minD * 0.05)
          g.addColorStop(0, V.rgba(o.accent, 0.7))
          g.addColorStop(1, V.rgba(o.accent, 0))
          ctx.beginPath()
          ctx.arc(px, cy, minD * 0.05, 0, TAU)
          ctx.fillStyle = g
          ctx.fill()
        }
      }
    },

    {
      id: 'cx-prism-refract',
      name: 'Prism Refraction',
      family: 'Abstract',
      blurb: 'A beam of light splitting through a glass prism into a fanned spectrum of bands.',
      init: (s) => bands(s, 22),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const minD = Math.min(W, H)
        const cy = H / 2
        const px = W * 0.42
        const triH = minD * 0.22

        ctx.beginPath()
        ctx.moveTo(px, cy - triH)
        ctx.lineTo(px + triH * 0.9, cy + triH * 0.7)
        ctx.lineTo(px - triH * 0.9, cy + triH * 0.7)
        ctx.closePath()
        ctx.fillStyle = V.rgba(o.accent, 0.1)
        ctx.strokeStyle = V.rgba(o.accent, 0.5)
        ctx.lineWidth = Math.max(1, minD * 0.003)
        ctx.fill()
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(0, cy)
        ctx.lineTo(px, cy)
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = Math.max(1.5, minD * 0.004)
        ctx.stroke()

        const fanX = px + triH * 0.5
        const spread = 0.55
        for (let i = 0; i < s.n; i++) {
          const t = i / (s.n - 1)
          const v = V.clamp(s.v[i], 0, 1)
          const a = -spread / 2 + t * spread
          const len = W - fanX
          const x2 = fanX + Math.cos(a) * len
          const y2 = cy + Math.sin(a) * len
          ctx.beginPath()
          ctx.moveTo(fanX, cy)
          ctx.lineTo(x2, y2)
          ctx.strokeStyle = V.paletteAt(o.palette, t, 0.15 + v * 0.7)
          ctx.lineWidth = Math.max(1, minD * (0.0015 + v * 0.003))
          ctx.stroke()
        }
      }
    }
  )
})()
