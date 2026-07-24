/* Prism visualizer lab — the in-house style set.
 *
 * Every style is a plain object: { id, name, blurb, trails?, init?, draw }.
 * The host clears (or fades, when trails is set) the canvas, computes the audio
 * frame once, and calls draw for each visible style. See index.html for the
 * host + the full contract; codex-visualizers.js follows the same contract.
 *
 * Canvas units are DEVICE pixels, so every size is derived from W/H/dpr.
 */

/* ------------------------------------------------------------------ utils */

const VIZ = (() => {
  const BINS = 1024 // analyser.frequencyBinCount (fftSize 2048)
  const SR = 44100
  const NYQ = SR / 2

  /** Log-spaced bin ranges. Music energy is bunched at the bottom, so linear
   *  bins leave the right-hand half of any visualizer permanently dead. */
  function bandRanges(count, fMin = 30, fMax = 16000) {
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
    return (((sum / (b1 - b0)) * 0.6 + max * 0.4) / 255)
  }

  /** Perceptual shaping: gamma for contrast, a gentle treble tilt so highs still
   *  move. Calibrated so a loud mix lands near 0.7 and only real peaks approach
   *  1.0. Overdriving these constants makes every bar sit pinned at full height,
   *  which reads as frantic rather than responsive. */
  function shape(v, i, n, o) {
    const tilt = 1 + (i / Math.max(1, n)) * 0.7
    return Math.pow(v, 1.85) * tilt * o.sensitivity * 0.45
  }

  /** smoothing 0 (instant) .. 0.95 (glacial) -> per-frame approach rate. */
  function rate(o) {
    return Math.max(0.04, 1 - o.smoothing)
  }

  /** Per-band adaptive gain: scale each band against its own slowly-decaying
   *  peak. Treble sits roughly ten times below bass in real music, so absolute
   *  scaling leaves the high bands flat, which is what kills the top half of a
   *  radial layout. The gate keeps genuine silence quiet rather than letting
   *  the normaliser amplify noise. */
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

  /** Blur a value array in place-ish (returns new array) for organic shapes. */
  function smoothArray(src, passes) {
    let a = src
    for (let p = 0; p < passes; p++) {
      const b = new Float32Array(a.length)
      for (let i = 0; i < a.length; i++) {
        const l = a[Math.max(0, i - 1)]
        const r = a[Math.min(a.length - 1, i + 1)]
        b[i] = (l + a[i] * 2 + r) / 4
      }
      a = b
    }
    return a
  }

  return { BINS, bandRanges, bandValue, shape, rate, adaptive, clamp, hexToRgb, mixRgb, paletteAt, rgba, smoothArray }
})()

/* ------------------------------------------------------------- the styles */

window.PRISM_VIZ = [
  /* 1 ---------------------------------------------------------------------- */
  {
    id: 'wave-bars',
    name: 'Wave Bars',
    blurb: 'Mirrored bars around a center line. Prism ships this one today.',
    init(s) {
      s.n = 96
      s.ranges = VIZ.bandRanges(s.n)
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

  /* 2 ---------------------------------------------------------------------- */
  {
    id: 'spectrum',
    name: 'Spectrum Bars',
    blurb: 'Bottom-anchored analyser bars with falling peak-hold caps.',
    init(s) {
      s.n = 64
      s.ranges = VIZ.bandRanges(s.n)
      s.v = new Float32Array(s.n)
      s.peak = new Float32Array(s.n)
    },
    draw(ctx, W, H, d, o, s) {
      const base = H * 0.94
      const maxH = H * 0.70
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

  /* 3 ---------------------------------------------------------------------- */
  {
    id: 'oscilloscope',
    name: 'Oscilloscope',
    blurb: 'The true waveform, drawn as a single glowing line. Flat at silence.',
    draw(ctx, W, H, d, o) {
      const mid = H / 2
      const amp = H * 0.30 * o.sensitivity
      const n = d.time.length
      const step = Math.max(1, Math.floor(n / Math.max(1, W / o.dpr / 1.5)))

      ctx.strokeStyle = VIZ.rgba(o.accent, 0.1)
      ctx.lineWidth = o.dpr
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(W, mid)
      ctx.stroke()

      ctx.lineWidth = 2.2 * o.dpr
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = VIZ.rgba(o.accent, 0.75)
      ctx.shadowBlur = 14 * o.dpr
      ctx.strokeStyle = o.accent

      ctx.beginPath()
      for (let i = 0, p = 0; i < n; i += step, p++) {
        const x = (i / (n - 1)) * W
        const y = mid + ((d.time[i] - 128) / 128) * amp
        if (p === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  },

  /* 4 ---------------------------------------------------------------------- */
  {
    id: 'wave-line',
    name: 'Wave Line',
    blurb: 'A smooth flowing wave that swells with the music. The calm cousin of the oscilloscope.',
    init(s) {
      s.amp = 0
      s.bass = 0
      s.phase = 0
      s.last = 0
    },
    draw(ctx, W, H, d, o, s) {
      // Driven by loudness rather than raw samples, so it flows instead of
      // buzzing. The oscilloscope shows the signal; this shows the feel of it.
      const dt = s.last ? Math.min(0.05, (d.t - s.last) / 1000) : 0.016
      s.last = d.t
      const k = Math.max(0.03, (1 - o.smoothing) * 0.22)
      // RMS of mastered audio sits low (~0.15), so drive it up before the curve,
      // otherwise the wave is a barely visible ripple.
      // Gate first so true silence is a perfectly flat line, then curve it.
      const raw = VIZ.clamp((d.level * 2.0 + d.bass * 0.3) * o.sensitivity, 0, 1)
      const drive = raw <= 0.035 ? 0 : (raw - 0.035) / 0.965
      const targetAmp = Math.pow(drive, 0.75)
      s.amp += (targetAmp - s.amp) * k
      s.bass += (VIZ.clamp(d.bass, 0, 1) - s.bass) * k
      s.phase += dt * (0.6 + s.bass * 0.9)

      const mid = H / 2
      const A = H * 0.18 * s.amp // no idle term: silence must be a flat line
      const layers = 3
      const steps = Math.max(48, Math.min(200, Math.round(W / (3 * o.dpr))))

      for (let L = layers - 1; L >= 0; L--) {
        const lp = L / (layers - 1 || 1)
        const speed = 1 + L * 0.35
        const scale = 1 - L * 0.28
        ctx.beginPath()
        for (let i = 0; i <= steps; i++) {
          const x = (i / steps) * W
          const u = i / steps
          // taper at both ends so the wave reads as one contained shape
          const envelope = Math.sin(Math.PI * u)
          const w =
            Math.sin(u * 6.2 + s.phase * speed) +
            0.5 * Math.sin(u * 11.3 - s.phase * speed * 1.3 + 1.7) +
            0.28 * Math.sin(u * 19.7 + s.phase * speed * 0.7 + 3.1)
          const y = mid + w * envelope * A * scale
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = VIZ.paletteAt(o.palette, 0.15 + lp * 0.7, L === 0 ? 1 : 0.34 - lp * 0.12)
        ctx.lineWidth = (L === 0 ? 2.6 : 1.8) * o.dpr
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        if (L === 0) {
          ctx.shadowColor = VIZ.rgba(o.accent, 0.55)
          ctx.shadowBlur = 12 * o.dpr
        }
        ctx.stroke()
        ctx.shadowBlur = 0
      }
    }
  },

  /* 5 ---------------------------------------------------------------------- */
  {
    id: 'liquid',
    name: 'Liquid Wave',
    blurb: 'A smooth filled band that swells with the mix. Organic, no hard edges.',
    init(s) {
      s.n = 56
      s.ranges = VIZ.bandRanges(s.n)
      s.v = new Float32Array(s.n)
    },
    draw(ctx, W, H, d, o, s) {
      const mid = H / 2
      const k = VIZ.rate(o)
      for (let i = 0; i < s.n; i++) {
        const target = VIZ.shape(VIZ.bandValue(d.freq, s.ranges[i]), i, s.n, o)
        s.v[i] += (target - s.v[i]) * k
      }
      const sm = VIZ.smoothArray(s.v, 3)
      const pts = []
      for (let i = 0; i < s.n; i++) {
        pts.push({
          x: (i / (s.n - 1)) * W,
          h: Math.max(0.03, sm[i]) * H * 0.28
        })
      }

      const trace = (sign) => {
        ctx.moveTo(pts[0].x, mid + sign * pts[0].h)
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]
          const b = pts[i + 1]
          const cx = (a.x + b.x) / 2
          ctx.quadraticCurveTo(a.x, mid + sign * a.h, cx, mid + sign * (a.h + b.h) / 2)
        }
        const last = pts[pts.length - 1]
        ctx.lineTo(last.x, mid + sign * last.h)
      }

      const g = ctx.createLinearGradient(0, 0, W, 0)
      g.addColorStop(0, VIZ.paletteAt(o.palette, 0, 0.85))
      g.addColorStop(0.5, VIZ.paletteAt(o.palette, 0.5, 0.85))
      g.addColorStop(1, VIZ.paletteAt(o.palette, 1, 0.85))

      ctx.beginPath()
      trace(-1)
      const rev = pts.slice().reverse()
      ctx.lineTo(rev[0].x, mid + rev[0].h)
      for (let i = 0; i < rev.length - 1; i++) {
        const a = rev[i]
        const b = rev[i + 1]
        const cx = (a.x + b.x) / 2
        ctx.quadraticCurveTo(a.x, mid + a.h, cx, mid + (a.h + b.h) / 2)
      }
      ctx.closePath()
      ctx.fillStyle = g
      ctx.fill()

      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = VIZ.rgba(o.accent, 0.12 + d.level * 0.18)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }
  },

  /* 6 ---------------------------------------------------------------------- */
  {
    id: 'radial-ring',
    name: 'Radial Ring',
    blurb: 'Spectrum rays around an open ring, balanced so the whole circle stays alive.',
    init(s) {
      s.half = 72
      // Stop at 12 kHz: bands above that carry almost nothing in real music, and
      // on a mirrored ring they land at the top seam as a dead notch.
      s.ranges = VIZ.bandRanges(s.half, 30, 12000)
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
        const raw = VIZ.bandValue(d.freq, s.ranges[i])
        s.v[i] += (VIZ.adaptive(s.pk, i, raw, o) - s.v[i]) * k
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
        // mirrored, so the figure is symmetric: lows at the bottom seam
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

  /* 7 ---------------------------------------------------------------------- */
  {
    id: 'orb',
    name: 'Waveform Orb',
    blurb: 'The waveform wrapped into a circle, so the outline breathes with the sound.',
    init(s) {
      s.N = 256
      s.r = new Float32Array(s.N)
    },
    draw(ctx, W, H, d, o, s) {
      const cx = W / 2
      const cy = H / 2
      const minD = Math.min(W, H)
      const R = minD * 0.25
      const amp = minD * 0.1 * o.sensitivity
      const N = s.N
      const n = d.time.length
      const k = Math.max(0.1, VIZ.rate(o))

      for (let i = 0; i < N; i++) {
        const target = ((d.time[Math.floor((i / N) * n) % n] - 128) / 128) * amp
        s.r[i] += (target - s.r[i]) * k
      }
      // wrap-around blur keeps the outline organic instead of spiky
      const sm = new Float32Array(N)
      for (let i = 0; i < N; i++) {
        sm[i] = (s.r[(i - 1 + N) % N] + s.r[i] * 2 + s.r[(i + 1) % N]) / 4
      }

      const path = (scale) => {
        ctx.beginPath()
        for (let i = 0; i <= N; i++) {
          const idx = i % N
          const a = (idx / N) * Math.PI * 2 - Math.PI / 2
          const r = R + sm[idx] * scale
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
      }

      path(1.9)
      ctx.strokeStyle = VIZ.rgba(o.accent, 0.16)
      ctx.lineWidth = Math.max(1, minD * 0.003)
      ctx.stroke()

      path(1)
      const g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R + amp)
      g.addColorStop(0, VIZ.paletteAt(o.palette, 0.15, 0.13))
      g.addColorStop(1, VIZ.paletteAt(o.palette, 0.85, 0.01))
      ctx.fillStyle = g
      ctx.fill()

      ctx.shadowColor = VIZ.rgba(o.accent, 0.75)
      ctx.shadowBlur = minD * 0.032
      ctx.strokeStyle = VIZ.paletteAt(o.palette, 0.4)
      ctx.lineWidth = Math.max(1.6, minD * 0.0058)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  },

  /* 8 ---------------------------------------------------------------------- */
  {
    id: 'spectrogram',
    name: 'Spectrogram',
    blurb: 'A scrolling heat map of the spectrum. Frequency up the side, time to the left.',
    init(s, W, H) {
      s.n = 128
      s.ranges = VIZ.bandRanges(s.n)
      s.off = document.createElement('canvas')
      s.off.width = Math.max(1, W)
      s.off.height = Math.max(1, H)
      s.octx = s.off.getContext('2d')
      s.octx.fillStyle = '#0b0d12'
      s.octx.fillRect(0, 0, W, H)
    },
    draw(ctx, W, H, d, o, s) {
      if (!s.octx) return
      const col = Math.max(1, Math.round(2 * o.dpr))
      // shift the history left by one column, then paint the new one at the edge
      s.octx.globalCompositeOperation = 'copy'
      s.octx.drawImage(s.off, -col, 0)
      s.octx.globalCompositeOperation = 'source-over'
      s.octx.fillStyle = '#0b0d12'
      s.octx.fillRect(W - col, 0, col, H)

      const cellH = H / s.n
      for (let i = 0; i < s.n; i++) {
        const v = VIZ.clamp(VIZ.shape(VIZ.bandValue(d.freq, s.ranges[i]), i, s.n, o), 0, 1)
        if (v <= 0.012) continue
        // low frequencies at the bottom
        const y = H - (i + 1) * cellH
        s.octx.fillStyle = VIZ.paletteAt(o.palette, VIZ.clamp(v * 1.15, 0, 1), VIZ.clamp(0.15 + v * 1.5, 0, 1))
        s.octx.fillRect(W - col, y, col, Math.ceil(cellH) + 1)
      }
      ctx.drawImage(s.off, 0, 0)
    }
  },

  /* 9 ---------------------------------------------------------------------- */
  {
    id: 'history',
    name: 'Waveform History',
    blurb: 'The last few seconds of loudness, scrolling by like a tape readout.',
    init(s, W, H) {
      s.bar = 3
      s.cap = Math.max(8, Math.ceil(W / s.bar) + 2)
      s.hist = new Float32Array(s.cap)
      s.tone = new Float32Array(s.cap)
      s.head = 0
      s.acc = 0
      s.accN = 0
      void H
    },
    draw(ctx, W, H, d, o, s) {
      const bw = Math.max(2, Math.round(3 * o.dpr))
      const gap = Math.max(1, Math.round(o.dpr))
      const slot = bw + gap
      const cap = Math.max(8, Math.ceil(W / slot) + 2)
      if (cap !== s.cap) {
        const h = new Float32Array(cap)
        const tn = new Float32Array(cap)
        h.set(s.hist.subarray(0, Math.min(cap, s.hist.length)))
        tn.set(s.tone.subarray(0, Math.min(cap, s.tone.length)))
        s.hist = h
        s.tone = tn
        s.cap = cap
        s.head = s.head % cap
      }

      // peak of this frame, plus a brightness cue for where the energy sits
      let peak = 0
      for (let i = 0; i < d.time.length; i += 4) {
        const v = Math.abs(d.time[i] - 128) / 128
        if (v > peak) peak = v
      }
      s.hist[s.head] = VIZ.clamp(Math.pow(peak, 1.6) * o.sensitivity, 0, 1.1)
      const tot = d.bass + d.mid + d.treble + 1e-6
      s.tone[s.head] = VIZ.clamp((d.mid * 0.5 + d.treble) / tot, 0, 1)
      s.head = (s.head + 1) % s.cap

      const mid = H / 2
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      ctx.fillRect(0, mid - o.dpr / 2, W, o.dpr)

      for (let x = 0; x < s.cap; x++) {
        // oldest at the left edge, newest at the right
        const idx = (s.head + x) % s.cap
        const v = s.hist[idx]
        if (v <= 0) continue
        const half = Math.max(o.dpr, v * H * 0.34)
        const px = x * slot
        if (px > W) break
        ctx.fillStyle = VIZ.paletteAt(o.palette, s.tone[idx])
        ctx.beginPath()
        ctx.roundRect(px, mid - half, bw, half * 2, bw / 2)
        ctx.fill()
      }
    }
  },

  /* 10 --------------------------------------------------------------------- */
  {
    id: 'particles',
    name: 'Particle Field',
    blurb: 'A drifting dot field that scatters on every kick and settles between them.',
    trails: true,
    init(s, W, H) {
      s.n = 160
      s.p = []
      for (let i = 0; i < s.n; i++) {
        const a = Math.random() * Math.PI * 2
        const r = Math.pow(Math.random(), 0.6) * 0.45
        s.p.push({
          a,
          r,
          band: Math.floor(Math.random() * 24),
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          seed: Math.random() * 100
        })
      }
      s.ranges = VIZ.bandRanges(24)
      void W
      void H
    },
    draw(ctx, W, H, d, o, s) {
      const cx = W / 2
      const cy = H / 2
      const minD = Math.min(W, H)
      const time = d.t / 1000

      for (let i = 0; i < s.p.length; i++) {
        const p = s.p[i]
        const band = VIZ.clamp(VIZ.bandValue(d.freq, s.ranges[p.band]) * o.sensitivity, 0, 1.4)
        // slow orbit + a kick that pushes outward, then eases home
        const ang = p.a + time * 0.12 + Math.sin(time * 0.4 + p.seed) * 0.15
        const push = d.beat * 0.09 + band * 0.055
        const rad = (p.r + push) * minD
        const x = cx + Math.cos(ang) * rad
        const y = cy + Math.sin(ang) * rad * 0.82
        const size = Math.max(o.dpr, (1.0 + band * 3.6) * o.dpr)

        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fillStyle = VIZ.paletteAt(o.palette, p.band / 23, VIZ.clamp(0.22 + band * 1.1, 0, 0.95))
        ctx.fill()
      }

      const glow = minD * (0.05 + d.bass * 0.13)
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glow)
      g.addColorStop(0, VIZ.rgba(o.accent, 0.5 * (0.3 + d.level)))
      g.addColorStop(1, VIZ.rgba(o.accent, 0))
      ctx.beginPath()
      ctx.arc(cx, cy, glow, 0, Math.PI * 2)
      ctx.fillStyle = g
      ctx.fill()
    }
  },

  /* 11 --------------------------------------------------------------------- */
  {
    id: 'vu',
    name: 'VU Meters',
    blurb: 'Segmented band meters with peak hold. The hi-fi readout, not a light show.',
    init(s) {
      s.v = [0, 0, 0, 0]
      s.peak = [0, 0, 0, 0]
    },
    draw(ctx, W, H, d, o, s) {
      const rows = [
        ['LOW', d.bass],
        ['MID', d.mid],
        ['HIGH', d.treble],
        ['OUT', d.level]
      ]
      const k = VIZ.rate(o)
      const padX = W * 0.07
      const labelW = Math.min(W * 0.16, 92 * o.dpr)
      const trackX = padX + labelW
      const trackW = W - trackX - padX
      const gapY = H * 0.055
      const rowH = (H - gapY * (rows.length + 1)) / rows.length
      const segW = Math.max(3 * o.dpr, trackW / 44)
      const segGap = Math.max(1.5 * o.dpr, segW * 0.32)
      const segs = Math.max(6, Math.floor(trackW / (segW + segGap)))

      ctx.font = `600 ${Math.round(Math.min(H * 0.09, 15 * o.dpr))}px ui-monospace, "Cascadia Mono", Consolas, monospace`
      ctx.textBaseline = 'middle'

      for (let r = 0; r < rows.length; r++) {
        const [label, raw] = rows[r]
        const target = VIZ.clamp(Math.pow(raw, 1.15) * o.sensitivity * 1.15, 0, 1)
        s.v[r] += (target - s.v[r]) * k
        s.peak[r] = Math.max(s.peak[r] - 0.005, s.v[r])

        const y = gapY + r * (rowH + gapY)
        const cyr = y + rowH / 2

        ctx.fillStyle = 'rgba(233,236,245,0.55)'
        ctx.fillText(label, padX, cyr)

        const lit = Math.round(s.v[r] * segs)
        const peakSeg = Math.round(s.peak[r] * segs)
        for (let i = 0; i < segs; i++) {
          const x = trackX + i * (segW + segGap)
          const t = i / (segs - 1)
          const on = i < lit
          const isPeak = i === peakSeg - 1 && peakSeg > 0
          if (on) ctx.fillStyle = VIZ.paletteAt(o.palette, t)
          else if (isPeak) ctx.fillStyle = 'rgba(255,255,255,0.6)'
          else ctx.fillStyle = 'rgba(255,255,255,0.07)'
          ctx.beginPath()
          ctx.roundRect(x, y + rowH * 0.16, segW, rowH * 0.68, segW * 0.3)
          ctx.fill()
        }
      }
    }
  },

  /* 12 --------------------------------------------------------------------- */
  {
    id: 'ripples',
    name: 'Bass Ripples',
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
        const raw = VIZ.bandValue(d.freq, s.ranges[i])
        s.v[i] += (VIZ.adaptive(s.pk, i, raw, o) - s.v[i]) * k
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
  }
]
