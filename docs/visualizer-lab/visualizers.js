/* Prism visualizer lab — the style set.
 *
 * Every style is a plain object: { id, name, family, blurb, trails?, init?, draw }.
 * The host clears (or fades, when trails is set) the canvas, computes the audio
 * frame once, and calls draw for each visible style. See index.html for the
 * host + the full contract.
 *
 * Canvas units are DEVICE pixels, so every size is derived from W/H/dpr.
 */

/* ------------------------------------------------------------------ utils */

const VIZ = (() => {
  const BINS = 1024 // analyser.frequencyBinCount (fftSize 2048)
  const SR = 44100
  const NYQ = SR / 2

  /** Log-spaced bin ranges. Music energy is bunched at the bottom, so linear
   *  bins leave the top of the spectrum permanently dead. Stops at 12 kHz by
   *  default: above that there is almost nothing in real music. */
  function bandRanges(count, fMin = 30, fMax = 12000) {
    const out = []
    for (let i = 0; i < count; i++) {
      const f0 = fMin * Math.pow(fMax / fMin, i / count)
      const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / count)
      let b0 = Math.floor((f0 / NYQ) * BINS)
      let b1 = Math.ceil((f1 / NYQ) * BINS)
      if (b1 <= b0) b1 = b0 + 1
      out.push([Math.min(b0, BINS - 1), Math.min(b1, BINS)])
    }
    return out
  }

  /** Average+peak blend for one band: average alone reads mushy, peak alone jitters. */
  function bandValue(freq, range) {
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

  /** Perceptual shaping: gamma for contrast, a gentle treble tilt so highs still
   *  move. Calibrated so a loud mix lands near 0.7 and only real peaks approach
   *  1.0; overdriving it pins everything at full height, which reads as frantic. */
  function shape(v, i, n, o) {
    const tilt = 1 + (i / Math.max(1, n)) * 0.7
    return Math.pow(v, 1.85) * tilt * o.sensitivity * 0.45
  }

  /** smoothing 0 (instant) .. 0.95 (glacial) -> per-frame approach rate. */
  function rate(o) {
    return Math.max(0.04, 1 - o.smoothing)
  }

  /** Per-band adaptive gain: scale each band against its own slowly-decaying
   *  peak. Treble sits roughly ten times under bass in real music, so absolute
   *  scaling leaves the high bands flat. The gate keeps genuine silence quiet
   *  instead of letting the normaliser amplify noise. */
  function adaptive(peaks, i, v, o) {
    peaks[i] = Math.max(v, peaks[i] * 0.993)
    const rel = v / Math.max(peaks[i], 0.045)
    const gate = clamp(v * 7, 0, 1)
    return clamp(rel * gate, 0, 1.05) * o.sensitivity * 0.82
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v
  }

  function hexToRgb(h) {
    const s = h.replace('#', '')
    const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  function mixRgb(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ]
  }

  /** Sample a palette (array of hex) at t in 0..1 -> "rgb(...)" */
  function paletteAt(pal, t, alpha) {
    t = clamp(t, 0, 1)
    const segs = pal.length - 1
    if (segs <= 0) {
      const c = hexToRgb(pal[0])
      return alpha == null ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
    }
    const x = t * segs
    const i = Math.min(segs - 1, Math.floor(x))
    const c = mixRgb(hexToRgb(pal[i]), hexToRgb(pal[i + 1]), x - i)
    return alpha == null ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
  }

  function rgba(hex, a) {
    const c = hexToRgb(hex)
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`
  }

  /** A gradient sweeping the palette across the given axis. */
  function sweep(ctx, x0, y0, x1, y1, pal, alpha) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    g.addColorStop(0, paletteAt(pal, 0, alpha))
    g.addColorStop(0.5, paletteAt(pal, 0.5, alpha))
    g.addColorStop(1, paletteAt(pal, 1, alpha))
    return g
  }

  /* ------------------------------------------------------------ the wave model
   *
   * The whole line does not move together. It stays flat until sound arrives,
   * and then each frequency band raises ONE perfect wave: a single sine period
   * under a bell envelope. The width of that wave is a constant, and it is
   * symmetric, so the rise always mirrors the fall. Only two things vary: how
   * tall the wave is (that band's level) and where it sits along the line
   * (that band's frequency, low on the left, high on the right).
   */

  // Few enough bands that neighbouring wavelets do NOT merge: band spacing
  // (1/13 = 0.077) stays wider than the wave width (0.055), so each band shows
  // one discrete wave sitting on an otherwise flat line, rather than a
  // continuous buzz of overlapping ripples.
  const WAVE_BANDS = 13
  const WAVE_WIDTH = 0.055

  function initWave(s, n) {
    s.n = n || WAVE_BANDS
    s.ranges = bandRanges(s.n)
    s.h = new Float32Array(s.n)
    s.pk = new Float32Array(s.n).fill(0.09)
    s.pos = new Float32Array(s.n)
    for (let i = 0; i < s.n; i++) s.pos[i] = (i + 0.5) / s.n
  }

  /** Refresh each band's height. Deliberately quick to respond: this family is
   *  meant to feel reactive, and the shape stays perfect regardless of speed. */
  function updateWave(s, d, o) {
    const k = Math.min(1, rate(o) * 1.8)
    for (let i = 0; i < s.n; i++) {
      const target = adaptive(s.pk, i, bandValue(d.freq, s.ranges[i]), o)
      s.h[i] += (target - s.h[i]) * k
    }
  }

  /** One wavelet: a single sine period inside a Gaussian envelope. Antisymmetric
   *  about its centre, so it rises and falls at matching angles every time. */
  function wavelet(dx, wl) {
    if (dx < -wl * 1.5 || dx > wl * 1.5) return 0 // compact support, for speed
    const sigma = wl * 0.42
    return Math.sin((2 * Math.PI * dx) / wl) * Math.exp(-(dx * dx) / (2 * sigma * sigma))
  }

  /** Sum every band's wavelet at position u (0..1 along the line). */
  function waveAt(s, u, wl) {
    let y = 0
    for (let i = 0; i < s.n; i++) {
      const h = s.h[i]
      if (h > 0.004) y += h * wavelet(u - s.pos[i], wl)
    }
    return y
  }

  return {
    BINS, bandRanges, bandValue, shape, rate, adaptive, clamp,
    hexToRgb, mixRgb, paletteAt, rgba, sweep,
    initWave, updateWave, wavelet, waveAt, WAVE_BANDS, WAVE_WIDTH
  }
})()

// Shared with the sibling style files (viz-*.js), which push onto PRISM_VIZ.
window.VIZ = VIZ

/* ------------------------------------------------------------- the styles */

window.PRISM_VIZ = [
  /* ============================================================ BARS ==== */
  {
    id: 'wave-bars',
    name: 'Wave Bars',
    family: 'Bars',
    blurb: 'Mirrored bars around a center line. Prism ships this one today.',
    init(s) {
      s.n = 96
      s.ranges = VIZ.bandRanges(s.n, 30, 16000)
      s.v = new Float32Array(s.n)
    },
    draw(ctx, W, H, d, o, s) {
      const mid = H / 2
      const slot = W / s.n
      const bw = Math.max(2 * o.dpr, slot * 0.62)
      const r = bw / 2
      const k = VIZ.rate(o)

      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(0, mid - o.dpr / 2, W, o.dpr)

      for (let i = 0; i < s.n; i++) {
        const target = VIZ.shape(VIZ.bandValue(d.freq, s.ranges[i]), i, s.n, o)
        s.v[i] += (target - s.v[i]) * k
        const half = Math.max(0.018, s.v[i]) * (H * 0.34)
        const x = i * slot + (slot - bw) / 2
        ctx.fillStyle = VIZ.paletteAt(o.palette, i / (s.n - 1))
        ctx.beginPath()
        ctx.roundRect(x, mid - half, bw, half * 2, r)
        ctx.fill()
      }
    }
  },

  {
    id: 'spectrum',
    name: 'Spectrum Bars',
    family: 'Bars',
    blurb: 'Bottom-anchored analyser bars with falling peak-hold caps.',
    init(s) {
      s.n = 64
      s.ranges = VIZ.bandRanges(s.n, 30, 16000)
      s.v = new Float32Array(s.n)
      s.peak = new Float32Array(s.n)
    },
    draw(ctx, W, H, d, o, s) {
      const base = H * 0.94
      const maxH = H * 0.7
      const slot = W / s.n
      const bw = Math.max(2 * o.dpr, slot * 0.7)
      const k = VIZ.rate(o)

      for (let i = 0; i < s.n; i++) {
        const target = VIZ.shape(VIZ.bandValue(d.freq, s.ranges[i]), i, s.n, o)
        s.v[i] += (target - s.v[i]) * k
        const v = VIZ.clamp(s.v[i], 0, 1.4)
        const h = Math.max(1.5 * o.dpr, v * maxH)

        s.peak[i] = Math.max(s.peak[i] - 0.006, v) // gravity on the cap
        const x = i * slot + (slot - bw) / 2

        const g = ctx.createLinearGradient(0, base, 0, base - h)
        g.addColorStop(0, VIZ.paletteAt(o.palette, 0, 0.85))
        g.addColorStop(1, VIZ.paletteAt(o.palette, VIZ.clamp(v / 1.1, 0, 1)))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.roundRect(x, base - h, bw, h, [bw / 2, bw / 2, 0, 0])
        ctx.fill()

        const py = base - Math.max(1.5 * o.dpr, VIZ.clamp(s.peak[i], 0, 1.4) * maxH) - 3 * o.dpr
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.fillRect(x, py, bw, Math.max(1, 2 * o.dpr))
      }
    }
  },

  /* ============================================================ WAVE ==== */
  {
    id: 'wave-line',
    name: 'Wave Line',
    family: 'Wave',
    blurb: 'Flat until sound arrives. Each band raises one perfect wave of fixed width; only height and position change.',
    init(s) {
      VIZ.initWave(s)
    },
    draw(ctx, W, H, d, o, s) {
      VIZ.updateWave(s, d, o)
      const mid = H / 2
      const wl = VIZ.WAVE_WIDTH // constant wave width, as a fraction of the line
      const amp = H * 0.34
      const steps = Math.max(140, Math.min(460, Math.round(W / (2 * o.dpr))))

      ctx.beginPath()
      for (let p = 0; p <= steps; p++) {
        const u = p / steps
        const y = mid - VIZ.waveAt(s, u, wl) * amp
        if (p === 0) ctx.moveTo(0, y)
        else ctx.lineTo(u * W, y)
      }
      ctx.strokeStyle = VIZ.sweep(ctx, 0, 0, W, 0, o.palette)
      ctx.lineWidth = 2.6 * o.dpr
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = VIZ.rgba(o.accent, 0.5)
      ctx.shadowBlur = 12 * o.dpr
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  },

  {
    id: 'mirror-wave',
    name: 'Mirror Wave',
    family: 'Wave',
    blurb: 'The same waves, reflected above and below the line and filled between.',
    init(s) {
      VIZ.initWave(s)
    },
    draw(ctx, W, H, d, o, s) {
      VIZ.updateWave(s, d, o)
      const mid = H / 2
      const wl = VIZ.WAVE_WIDTH
      const amp = H * 0.3
      const steps = Math.max(120, Math.min(360, Math.round(W / (3 * o.dpr))))
      const ys = new Float32Array(steps + 1)
      for (let p = 0; p <= steps; p++) ys[p] = Math.abs(VIZ.waveAt(s, p / steps, wl)) * amp

      ctx.beginPath()
      for (let p = 0; p <= steps; p++) {
        const x = (p / steps) * W
        if (p === 0) ctx.moveTo(x, mid - ys[p])
        else ctx.lineTo(x, mid - ys[p])
      }
      for (let p = steps; p >= 0; p--) ctx.lineTo((p / steps) * W, mid + ys[p])
      ctx.closePath()
      ctx.fillStyle = VIZ.sweep(ctx, 0, 0, W, 0, o.palette, 0.55)
      ctx.fill()

      ctx.strokeStyle = VIZ.sweep(ctx, 0, 0, W, 0, o.palette)
      ctx.lineWidth = 1.8 * o.dpr
      ctx.stroke()

      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      ctx.fillRect(0, mid - o.dpr / 2, W, o.dpr)
    }
  },

  {
    id: 'liquid',
    name: 'Liquid Wave',
    family: 'Wave',
    blurb: 'A smooth filled band that swells with the mix. Organic, no hard edges.',
    init(s) {
      s.n = 56
      s.ranges = VIZ.bandRanges(s.n, 30, 16000)
      s.v = new Float32Array(s.n)
    },
    draw(ctx, W, H, d, o, s) {
      const mid = H / 2
      const k = VIZ.rate(o)
      for (let i = 0; i < s.n; i++) {
        const target = VIZ.shape(VIZ.bandValue(d.freq, s.ranges[i]), i, s.n, o)
        s.v[i] += (target - s.v[i]) * k
      }
      // spatial blur, so the band reads as one liquid shape
      let a = s.v
      for (let pass = 0; pass < 3; pass++) {
        const b = new Float32Array(a.length)
        for (let i = 0; i < a.length; i++) {
          const l = a[Math.max(0, i - 1)]
          const r = a[Math.min(a.length - 1, i + 1)]
          b[i] = (l + a[i] * 2 + r) / 4
        }
        a = b
      }

      const pts = []
      for (let i = 0; i < s.n; i++) {
        pts.push({ x: (i / (s.n - 1)) * W, h: Math.max(0.03, a[i]) * H * 0.28 })
      }

      const side = (sign) => {
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i]
          const p1 = pts[i + 1]
          const cx = (p0.x + p1.x) / 2
          ctx.quadraticCurveTo(p0.x, mid + sign * p0.h, cx, mid + sign * (p0.h + p1.h) / 2)
        }
        const last = pts[pts.length - 1]
        ctx.lineTo(last.x, mid + sign * last.h)
      }

      ctx.beginPath()
      ctx.moveTo(pts[0].x, mid - pts[0].h)
      side(-1)
      ctx.lineTo(pts[pts.length - 1].x, mid + pts[pts.length - 1].h)
      for (let i = pts.length - 1; i > 0; i--) {
        const p0 = pts[i]
        const p1 = pts[i - 1]
        const cx = (p0.x + p1.x) / 2
        ctx.quadraticCurveTo(p0.x, mid + p0.h, cx, mid + (p0.h + p1.h) / 2)
      }
      ctx.closePath()
      ctx.fillStyle = VIZ.sweep(ctx, 0, 0, W, 0, o.palette, 0.85)
      ctx.fill()
    }
  },

  {
    id: 'ribbon',
    name: 'Ribbon Wave',
    family: 'Wave',
    blurb: 'One wave drawn as a ribbon that thickens where the sound is loudest.',
    init(s) {
      VIZ.initWave(s)
    },
    draw(ctx, W, H, d, o, s) {
      VIZ.updateWave(s, d, o)
      const mid = H / 2
      const wl = VIZ.WAVE_WIDTH
      const amp = H * 0.26
      const steps = Math.max(110, Math.min(320, Math.round(W / (3.5 * o.dpr))))
      const base = Math.max(1.2 * o.dpr, H * 0.008)

      const yy = new Float32Array(steps + 1)
      const tt = new Float32Array(steps + 1)
      for (let p = 0; p <= steps; p++) {
        const v = VIZ.waveAt(s, p / steps, wl)
        yy[p] = mid - v * amp
        tt[p] = base * (0.5 + Math.abs(v) * 5)
      }

      ctx.beginPath()
      for (let p = 0; p <= steps; p++) ctx.lineTo((p / steps) * W, yy[p] - tt[p])
      for (let p = steps; p >= 0; p--) ctx.lineTo((p / steps) * W, yy[p] + tt[p])
      ctx.closePath()
      ctx.fillStyle = VIZ.sweep(ctx, 0, 0, W, 0, o.palette)
      ctx.shadowColor = VIZ.rgba(o.accent, 0.45)
      ctx.shadowBlur = 14 * o.dpr
      ctx.fill()
      ctx.shadowBlur = 0
    }
  },

  {
    id: 'dot-wave',
    name: 'Dot Wave',
    family: 'Wave',
    blurb: 'The same wave sampled into beads, each one growing with its own band.',
    init(s) {
      VIZ.initWave(s)
    },
    draw(ctx, W, H, d, o, s) {
      VIZ.updateWave(s, d, o)
      const mid = H / 2
      const wl = VIZ.WAVE_WIDTH
      const amp = H * 0.3
      const dots = Math.max(28, Math.min(110, Math.round(W / (14 * o.dpr))))
      const rBase = Math.max(1.4 * o.dpr, W / dots / 5)

      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      ctx.fillRect(0, mid - o.dpr / 2, W, o.dpr)

      for (let i = 0; i <= dots; i++) {
        const u = i / dots
        const v = VIZ.waveAt(s, u, wl)
        const y = mid - v * amp
        const r = rBase * (0.75 + Math.abs(v) * 6)
        ctx.beginPath()
        ctx.arc(u * W, y, r, 0, Math.PI * 2)
        ctx.fillStyle = VIZ.paletteAt(o.palette, u, VIZ.clamp(0.35 + Math.abs(v) * 5, 0, 1))
        ctx.fill()
      }
    }
  },

  {
    id: 'echo-wave',
    name: 'Echo Wave',
    family: 'Wave',
    blurb: 'The wave leaves a fading trail behind it, so you see the last moment of sound.',
    trails: true,
    init(s) {
      VIZ.initWave(s)
    },
    draw(ctx, W, H, d, o, s) {
      VIZ.updateWave(s, d, o)
      const mid = H / 2
      const wl = VIZ.WAVE_WIDTH
      const amp = H * 0.3
      const steps = Math.max(120, Math.min(380, Math.round(W / (2.5 * o.dpr))))

      ctx.beginPath()
      for (let p = 0; p <= steps; p++) {
        const u = p / steps
        const y = mid - VIZ.waveAt(s, u, wl) * amp
        if (p === 0) ctx.moveTo(0, y)
        else ctx.lineTo(u * W, y)
      }
      ctx.strokeStyle = VIZ.sweep(ctx, 0, 0, W, 0, o.palette)
      ctx.lineWidth = 2.2 * o.dpr
      ctx.lineJoin = 'round'
      ctx.shadowColor = VIZ.rgba(o.accent, 0.6)
      ctx.shadowBlur = 16 * o.dpr
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  },

  /* ======================================================== CIRCULAR ==== */
  {
    id: 'radial-ring',
    name: 'Radial Ring',
    family: 'Circular',
    blurb: 'Spectrum rays around an open ring, balanced so the whole circle stays alive.',
    init(s) {
      s.half = 72
      s.ranges = VIZ.bandRanges(s.half)
      s.v = new Float32Array(s.half)
      s.pk = new Float32Array(s.half).fill(0.09)
      s.boom = 0
    },
    draw(ctx, W, H, d, o, s) {
      const cx = W / 2
      const cy = H / 2
      const minD = Math.min(W, H)
      const k = VIZ.rate(o)

      for (let i = 0; i < s.half; i++) {
        s.v[i] += (VIZ.adaptive(s.pk, i, VIZ.bandValue(d.freq, s.ranges[i]), o) - s.v[i]) * k
      }
      s.boom = Math.max(d.beat, s.boom * 0.93)

      const R = minD * 0.23 * (1 + s.boom * 0.03)

      // A soft interior glow, NOT a filled disc. A solid centre reads as a muddy
      // ball and leaves a dead ring of background between it and the rays.
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
      g.addColorStop(0, VIZ.rgba(o.accent, 0.03 + d.bass * 0.15))
      g.addColorStop(1, VIZ.rgba(o.accent, 0))
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.fillStyle = g
      ctx.fill()

      const total = s.half * 2
      ctx.lineCap = 'round'
      ctx.lineWidth = Math.max(1.5, minD * 0.0085)
      ctx.shadowColor = VIZ.rgba(o.accent, 0.45)
      ctx.shadowBlur = minD * 0.018
      for (let j = 0; j < total; j++) {
        const m = j < s.half ? j : total - 1 - j
        const t = m / (s.half - 1)
        const a = Math.PI / 2 + ((j + 0.5) / total) * Math.PI * 2
        const len = (0.022 + s.v[m] * 0.185) * minD
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        ctx.strokeStyle = VIZ.paletteAt(o.palette, t)
        ctx.beginPath()
        ctx.moveTo(cx + ca * R, cy + sa * R)
        ctx.lineTo(cx + ca * (R + len), cy + sa * (R + len))
        ctx.stroke()
      }
      ctx.shadowBlur = 0

      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.strokeStyle = VIZ.rgba(o.accent, 0.5)
      ctx.lineWidth = Math.max(1, minD * 0.0035)
      ctx.stroke()
    }
  },

  {
    id: 'ripples',
    name: 'Bass Ripples',
    family: 'Circular',
    blurb: 'Rings fire on every kick and spread outward through a spectrum halo.',
    init(s) {
      s.rings = []
      s.n = 64
      s.ranges = VIZ.bandRanges(s.n)
      s.v = new Float32Array(s.n)
      s.pk = new Float32Array(s.n).fill(0.09)
      s.armed = true
    },
    draw(ctx, W, H, d, o, s) {
      const cx = W / 2
      const cy = H / 2
      const minD = Math.min(W, H)
      const k = VIZ.rate(o)

      // one ring per transient: re-arm on the way down so kicks do not smear
      if (d.beat > 0.5 && s.armed) {
        s.rings.push({ r: minD * 0.14, life: 1 })
        s.armed = false
      }
      if (d.beat < 0.22) s.armed = true
      if (s.rings.length > 20) s.rings.splice(0, s.rings.length - 20)

      for (let i = 0; i < s.n; i++) {
        s.v[i] += (VIZ.adaptive(s.pk, i, VIZ.bandValue(d.freq, s.ranges[i]), o) - s.v[i]) * k
      }

      for (let i = s.rings.length - 1; i >= 0; i--) {
        const ring = s.rings[i]
        ring.r += minD * 0.0055 + minD * 0.005 * ring.life
        ring.life -= 0.011
        if (ring.life <= 0 || ring.r > minD * 0.8) {
          s.rings.splice(i, 1)
          continue
        }
        ctx.beginPath()
        ctx.arc(cx, cy, ring.r, 0, Math.PI * 2)
        ctx.strokeStyle = VIZ.rgba(o.accent, VIZ.clamp(ring.life * 0.7, 0, 1))
        ctx.lineWidth = Math.max(1, minD * 0.007 * ring.life)
        ctx.stroke()
      }

      const R = minD * 0.15
      ctx.lineCap = 'round'
      ctx.lineWidth = Math.max(1.4, minD * 0.007)
      ctx.shadowColor = VIZ.rgba(o.accent, 0.4)
      ctx.shadowBlur = minD * 0.014
      for (let i = 0; i < s.n; i++) {
        const a = (i / s.n) * Math.PI * 2 - Math.PI / 2
        const len = (0.02 + s.v[i] * 0.13) * minD
        ctx.strokeStyle = VIZ.paletteAt(o.palette, i / (s.n - 1))
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R)
        ctx.lineTo(cx + Math.cos(a) * (R + len), cy + Math.sin(a) * (R + len))
        ctx.stroke()
      }
      ctx.shadowBlur = 0

      const core = R * 0.5 * (1 + d.beat * 0.18)
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, core)
      cg.addColorStop(0, VIZ.rgba(o.accent, 0.5 + d.beat * 0.35))
      cg.addColorStop(1, VIZ.rgba(o.accent, 0))
      ctx.beginPath()
      ctx.arc(cx, cy, core, 0, Math.PI * 2)
      ctx.fillStyle = cg
      ctx.fill()
    }
  },

  {
    id: 'wave-ring',
    name: 'Wave Ring',
    family: 'Circular',
    blurb: 'The wave model bent into a circle: perfect waves of fixed width around a ring.',
    init(s) {
      VIZ.initWave(s, 24)
    },
    draw(ctx, W, H, d, o, s) {
      VIZ.updateWave(s, d, o)
      const cx = W / 2
      const cy = H / 2
      const minD = Math.min(W, H)
      const R = minD * 0.24
      const amp = minD * 0.2
      const wl = VIZ.WAVE_WIDTH
      const steps = 300

      ctx.beginPath()
      for (let p = 0; p <= steps; p++) {
        let u = p / steps
        // wrap the wavelet field so the seam is continuous
        let y = 0
        for (let i = 0; i < s.n; i++) {
          const h = s.h[i]
          if (h <= 0.004) continue
          let dx = u - s.pos[i]
          if (dx > 0.5) dx -= 1
          if (dx < -0.5) dx += 1
          y += h * VIZ.wavelet(dx, wl)
        }
        const a = u * Math.PI * 2 - Math.PI / 2
        const r = R + y * amp
        const x = cx + Math.cos(a) * r
        const yy = cy + Math.sin(a) * r
        if (p === 0) ctx.moveTo(x, yy)
        else ctx.lineTo(x, yy)
      }
      ctx.closePath()
      ctx.strokeStyle = VIZ.sweep(ctx, cx - R, cy - R, cx + R, cy + R, o.palette)
      ctx.lineWidth = Math.max(1.8, minD * 0.006)
      ctx.lineJoin = 'round'
      ctx.shadowColor = VIZ.rgba(o.accent, 0.55)
      ctx.shadowBlur = minD * 0.03
      ctx.stroke()
      ctx.shadowBlur = 0

      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.strokeStyle = VIZ.rgba(o.accent, 0.16)
      ctx.lineWidth = Math.max(1, minD * 0.002)
      ctx.stroke()
    }
  },

  {
    id: 'concentric',
    name: 'Concentric Bands',
    family: 'Circular',
    blurb: 'One ring per frequency band, lows inside and highs outside, breathing in place.',
    init(s) {
      s.n = 14
      s.ranges = VIZ.bandRanges(s.n)
      s.v = new Float32Array(s.n)
      s.pk = new Float32Array(s.n).fill(0.09)
    },
    draw(ctx, W, H, d, o, s) {
      const cx = W / 2
      const cy = H / 2
      const minD = Math.min(W, H)
      const k = VIZ.rate(o)
      const inner = minD * 0.07
      const step = (minD * 0.4 - inner) / s.n

      for (let i = 0; i < s.n; i++) {
        s.v[i] += (VIZ.adaptive(s.pk, i, VIZ.bandValue(d.freq, s.ranges[i]), o) - s.v[i]) * k
      }

      for (let i = s.n - 1; i >= 0; i--) {
        const v = VIZ.clamp(s.v[i], 0, 1)
        const r = inner + step * (i + 1) + v * step * 0.55
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.strokeStyle = VIZ.paletteAt(o.palette, i / (s.n - 1), VIZ.clamp(0.12 + v * 1.1, 0, 1))
        ctx.lineWidth = Math.max(1, step * (0.12 + v * 0.5))
        ctx.stroke()
      }

      const core = inner * (1 + d.beat * 0.35)
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, core)
      g.addColorStop(0, VIZ.rgba(o.accent, 0.45 + d.bass * 0.4))
      g.addColorStop(1, VIZ.rgba(o.accent, 0))
      ctx.beginPath()
      ctx.arc(cx, cy, core, 0, Math.PI * 2)
      ctx.fillStyle = g
      ctx.fill()
    }
  },

  {
    id: 'arc-spectrum',
    name: 'Arc Spectrum',
    family: 'Circular',
    blurb: 'The spectrum wrapped into a dial, each band a thickening arc segment.',
    init(s) {
      s.n = 48
      s.ranges = VIZ.bandRanges(s.n)
      s.v = new Float32Array(s.n)
      s.pk = new Float32Array(s.n).fill(0.09)
    },
    draw(ctx, W, H, d, o, s) {
      const cx = W / 2
      const cy = H / 2
      const minD = Math.min(W, H)
      const k = VIZ.rate(o)
      const R = minD * 0.27
      const maxT = minD * 0.11
      const span = (Math.PI * 2) / s.n
      const gap = span * 0.22

      for (let i = 0; i < s.n; i++) {
        s.v[i] += (VIZ.adaptive(s.pk, i, VIZ.bandValue(d.freq, s.ranges[i]), o) - s.v[i]) * k
      }

      ctx.lineCap = 'butt'
      for (let i = 0; i < s.n; i++) {
        const v = VIZ.clamp(s.v[i], 0, 1)
        const t = Math.max(minD * 0.006, v * maxT)
        const a0 = -Math.PI / 2 + i * span + gap / 2
        const a1 = a0 + span - gap
        ctx.beginPath()
        ctx.arc(cx, cy, R, a0, a1)
        ctx.strokeStyle = VIZ.paletteAt(o.palette, i / (s.n - 1), VIZ.clamp(0.3 + v, 0, 1))
        ctx.lineWidth = t
        ctx.stroke()
      }

      ctx.beginPath()
      ctx.arc(cx, cy, R - maxT * 0.62, 0, Math.PI * 2)
      ctx.strokeStyle = VIZ.rgba(o.accent, 0.18)
      ctx.lineWidth = Math.max(1, minD * 0.002)
      ctx.stroke()
    }
  },

  {
    id: 'orbit',
    name: 'Orbit Dots',
    family: 'Circular',
    blurb: 'Beads riding a ring, pushed outward by their own band and turning slowly.',
    init(s) {
      s.n = 56
      s.ranges = VIZ.bandRanges(s.n)
      s.v = new Float32Array(s.n)
      s.pk = new Float32Array(s.n).fill(0.09)
    },
    draw(ctx, W, H, d, o, s) {
      const cx = W / 2
      const cy = H / 2
      const minD = Math.min(W, H)
      const k = VIZ.rate(o)
      const R = minD * 0.24
      const spin = (d.t / 1000) * 0.08

      for (let i = 0; i < s.n; i++) {
        s.v[i] += (VIZ.adaptive(s.pk, i, VIZ.bandValue(d.freq, s.ranges[i]), o) - s.v[i]) * k
      }

      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.strokeStyle = VIZ.rgba(o.accent, 0.14)
      ctx.lineWidth = Math.max(1, minD * 0.002)
      ctx.stroke()

      for (let i = 0; i < s.n; i++) {
        const v = VIZ.clamp(s.v[i], 0, 1)
        const a = (i / s.n) * Math.PI * 2 - Math.PI / 2 + spin
        const r = R + v * minD * 0.16
        const rad = Math.max(1.2 * o.dpr, minD * (0.004 + v * 0.014))
        ctx.beginPath()
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rad, 0, Math.PI * 2)
        ctx.fillStyle = VIZ.paletteAt(o.palette, i / (s.n - 1), VIZ.clamp(0.3 + v * 1.2, 0, 1))
        ctx.fill()
      }
    }
  },

  {
    id: 'spiral',
    name: 'Spiral Spectrum',
    family: 'Circular',
    blurb: 'The spectrum wound outward along a spiral, lows at the middle.',
    init(s) {
      s.n = 120
      s.ranges = VIZ.bandRanges(s.n)
      s.v = new Float32Array(s.n)
      s.pk = new Float32Array(s.n).fill(0.09)
    },
    draw(ctx, W, H, d, o, s) {
      const cx = W / 2
      const cy = H / 2
      const minD = Math.min(W, H)
      const k = VIZ.rate(o)
      const turns = 3
      const rMax = minD * 0.4

      for (let i = 0; i < s.n; i++) {
        s.v[i] += (VIZ.adaptive(s.pk, i, VIZ.bandValue(d.freq, s.ranges[i]), o) - s.v[i]) * k
      }

      ctx.lineCap = 'round'
      for (let i = 0; i < s.n; i++) {
        const u = i / (s.n - 1)
        const a = u * Math.PI * 2 * turns - Math.PI / 2
        const r = minD * 0.06 + u * (rMax - minD * 0.06)
        const v = VIZ.clamp(s.v[i], 0, 1)
        const len = minD * (0.008 + v * 0.06)
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        ctx.beginPath()
        ctx.moveTo(cx + ca * (r - len / 2), cy + sa * (r - len / 2))
        ctx.lineTo(cx + ca * (r + len / 2), cy + sa * (r + len / 2))
        ctx.strokeStyle = VIZ.paletteAt(o.palette, u, VIZ.clamp(0.28 + v * 1.1, 0, 1))
        ctx.lineWidth = Math.max(1.2, minD * 0.006)
        ctx.stroke()
      }
    }
  }
]
