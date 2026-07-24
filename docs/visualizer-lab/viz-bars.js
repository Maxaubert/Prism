/* Bar-family visualizer styles. Pushes onto window.PRISM_VIZ. */
(() => {
  const V = window.VIZ

  /** Standard band setup: log-spaced ranges + smoothing + per-band peak store. */
  function bands(s, n, fmax) {
    s.n = n
    s.ranges = V.bandRanges(n, 30, fmax || 12000)
    s.v = new Float32Array(n)
    s.pk = new Float32Array(n).fill(0.09)
    s.peak = new Float32Array(n)
  }
  function upd(s, d, o, mult) {
    const k = Math.min(1, V.rate(o) * (mult || 1))
    for (let i = 0; i < s.n; i++) {
      const t = V.adaptive(s.pk, i, V.bandValue(d.freq, s.ranges[i]), o)
      s.v[i] += (t - s.v[i]) * k
    }
  }

  window.PRISM_VIZ.push(
    {
      id: 'led-bars',
      name: 'LED Bars',
      family: 'Bars',
      blurb: 'Bars built from stacked LED segments, like a rack meter.',
      init: (s) => bands(s, 32),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const slot = W / s.n
        const bw = slot * 0.68
        const rows = 20
        const cellH = (H * 0.86) / rows
        const gap = cellH * 0.24
        const base = H * 0.94
        for (let i = 0; i < s.n; i++) {
          const lit = Math.round(V.clamp(s.v[i], 0, 1) * rows)
          const x = i * slot + (slot - bw) / 2
          for (let r = 0; r < rows; r++) {
            const y = base - (r + 1) * cellH
            const on = r < lit
            ctx.fillStyle = on
              ? V.paletteAt(o.palette, r / (rows - 1))
              : 'rgba(255,255,255,0.05)'
            ctx.fillRect(x, y + gap / 2, bw, cellH - gap)
          }
        }
      }
    },

    {
      id: 'thin-lines',
      name: 'Hairlines',
      family: 'Bars',
      blurb: 'A dense comb of hairline bars. Quiet and technical.',
      init: (s) => bands(s, 140, 16000),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const base = H * 0.92
        ctx.lineWidth = Math.max(1, o.dpr)
        for (let i = 0; i < s.n; i++) {
          const x = ((i + 0.5) / s.n) * W
          const h = V.clamp(s.v[i], 0, 1) * H * 0.72
          ctx.strokeStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.9)
          ctx.beginPath()
          ctx.moveTo(x, base)
          ctx.lineTo(x, base - Math.max(o.dpr, h))
          ctx.stroke()
        }
      }
    },

    {
      id: 'pyramid-bars',
      name: 'Pyramid',
      family: 'Bars',
      blurb: 'Bars grown from the centre outwards, tallest in the middle.',
      init: (s) => bands(s, 48),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const mid = H / 2
        const slot = W / s.n
        const bw = slot * 0.66
        for (let i = 0; i < s.n; i++) {
          // low frequencies at the centre, mirrored outward
          const half = s.n / 2
          const m = i < half ? half - 1 - i : i - half
          const v = V.clamp(s.v[Math.min(s.n - 1, m * 2)], 0, 1)
          const h = Math.max(o.dpr, v * H * 0.42)
          const x = i * slot + (slot - bw) / 2
          ctx.fillStyle = V.paletteAt(o.palette, 1 - m / half, 0.95)
          ctx.beginPath()
          ctx.roundRect(x, mid - h, bw, h * 2, bw / 2)
          ctx.fill()
        }
      }
    },

    {
      id: 'h-bars',
      name: 'Side Bars',
      family: 'Bars',
      blurb: 'The spectrum turned on its side, lows at the bottom.',
      init: (s) => bands(s, 28),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const rowH = H / s.n
        const bh = rowH * 0.68
        const x0 = W * 0.06
        const maxW = W * 0.88
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const y = H - (i + 1) * rowH + (rowH - bh) / 2
          const w = Math.max(o.dpr * 2, v * maxW)
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.95)
          ctx.beginPath()
          ctx.roundRect(x0, y, w, bh, bh / 2)
          ctx.fill()
        }
      }
    },

    {
      id: 'outline-bars',
      name: 'Outline Bars',
      family: 'Bars',
      blurb: 'Hollow bars with a bright cap riding the top of each band.',
      init: (s) => bands(s, 30),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const slot = W / s.n
        const bw = slot * 0.7
        const base = H * 0.92
        const maxH = H * 0.74
        ctx.lineWidth = Math.max(1, 1.4 * o.dpr)
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          s.peak[i] = Math.max(s.peak[i] - 0.007, v)
          const h = Math.max(2 * o.dpr, v * maxH)
          const x = i * slot + (slot - bw) / 2
          const col = V.paletteAt(o.palette, i / (s.n - 1))
          ctx.strokeStyle = col
          ctx.strokeRect(x, base - h, bw, h)
          ctx.fillStyle = col
          ctx.fillRect(x, base - Math.max(2 * o.dpr, s.peak[i] * maxH) - 3 * o.dpr, bw, 2.5 * o.dpr)
        }
      }
    },

    {
      id: 'blocks',
      name: 'Block Stack',
      family: 'Bars',
      blurb: 'Chunky blocks stacking up per band, with gaps you can count.',
      init: (s) => bands(s, 20),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.9)
        const slot = W / s.n
        const bw = slot * 0.76
        const rows = 12
        const cell = (H * 0.84) / rows
        const base = H * 0.93
        for (let i = 0; i < s.n; i++) {
          const lit = Math.round(V.clamp(s.v[i], 0, 1) * rows)
          const x = i * slot + (slot - bw) / 2
          for (let r = 0; r < lit; r++) {
            const y = base - (r + 1) * cell
            ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.35 + (r / rows) * 0.65)
            ctx.beginPath()
            ctx.roundRect(x, y + cell * 0.12, bw, cell * 0.76, cell * 0.16)
            ctx.fill()
          }
        }
      }
    },

    {
      id: 'staggered',
      name: 'Staggered',
      family: 'Bars',
      blurb: 'Alternating bars hang from the top and rise from the floor.',
      init: (s) => bands(s, 40),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const slot = W / s.n
        const bw = slot * 0.6
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const h = Math.max(o.dpr * 2, v * H * 0.55)
          const x = i * slot + (slot - bw) / 2
          const down = i % 2 === 0
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.92)
          ctx.beginPath()
          ctx.roundRect(x, down ? 0 : H - h, bw, h, bw / 2)
          ctx.fill()
        }
      }
    },

    {
      id: 'gradient-columns',
      name: 'Columns',
      family: 'Bars',
      blurb: 'Wide columns that fade out towards their tips.',
      init: (s) => bands(s, 16),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.8)
        const slot = W / s.n
        const bw = slot * 0.86
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const h = Math.max(o.dpr, v * H * 0.9)
          const x = i * slot + (slot - bw) / 2
          const g = ctx.createLinearGradient(0, H, 0, H - h)
          g.addColorStop(0, V.paletteAt(o.palette, i / (s.n - 1), 0.95))
          g.addColorStop(1, V.paletteAt(o.palette, i / (s.n - 1), 0))
          ctx.fillStyle = g
          ctx.fillRect(x, H - h, bw, h)
        }
      }
    },

    {
      id: 'twin-bars',
      name: 'Twin Bars',
      family: 'Bars',
      blurb: 'Two spectra facing each other across a gap.',
      init: (s) => bands(s, 44),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const slot = W / s.n
        const bw = slot * 0.62
        const gap = H * 0.06
        const maxH = (H - gap) / 2
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const h = Math.max(o.dpr, v * maxH * 0.92)
          const x = i * slot + (slot - bw) / 2
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1))
          ctx.beginPath()
          ctx.roundRect(x, H / 2 - gap / 2 - h, bw, h, [bw / 2, bw / 2, 0, 0])
          ctx.fill()
          ctx.globalAlpha = 0.45
          ctx.beginPath()
          ctx.roundRect(x, H / 2 + gap / 2, bw, h, [0, 0, bw / 2, bw / 2])
          ctx.fill()
          ctx.globalAlpha = 1
        }
      }
    },

    {
      id: 'tapered',
      name: 'Tapered Bars',
      family: 'Bars',
      blurb: 'Bars that narrow as they rise, like slim spikes.',
      init: (s) => bands(s, 36),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const slot = W / s.n
        const base = H * 0.92
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const h = Math.max(o.dpr, v * H * 0.76)
          const cx = (i + 0.5) * slot
          const bw = slot * 0.62
          ctx.beginPath()
          ctx.moveTo(cx - bw / 2, base)
          ctx.lineTo(cx + bw / 2, base)
          ctx.lineTo(cx + bw * 0.14, base - h)
          ctx.lineTo(cx - bw * 0.14, base - h)
          ctx.closePath()
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.95)
          ctx.fill()
        }
      }
    },

    {
      id: 'floating-caps',
      name: 'Floating Caps',
      family: 'Bars',
      blurb: 'Only the peak caps, hovering with no bar beneath them.',
      init: (s) => bands(s, 40),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const slot = W / s.n
        const bw = slot * 0.72
        const base = H * 0.9
        const maxH = H * 0.74
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          s.peak[i] = Math.max(s.peak[i] - 0.006, v)
          const y = base - Math.max(o.dpr, s.peak[i] * maxH)
          const x = i * slot + (slot - bw) / 2
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1))
          ctx.beginPath()
          ctx.roundRect(x, y, bw, 3 * o.dpr, 1.5 * o.dpr)
          ctx.fill()
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.16)
          ctx.fillRect(x, y + 4 * o.dpr, bw, base - y)
        }
      }
    },

    {
      id: 'centre-out',
      name: 'Centre Out',
      family: 'Bars',
      blurb: 'Bass in the middle, treble pushed out to both edges.',
      init: (s) => bands(s, 33),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const mid = H * 0.92
        const half = Math.floor(s.n / 2)
        const slot = W / s.n
        const bw = slot * 0.7
        for (let i = 0; i < s.n; i++) {
          const m = Math.abs(i - half)
          const v = V.clamp(s.v[m], 0, 1)
          const h = Math.max(o.dpr, v * H * 0.78)
          const x = i * slot + (slot - bw) / 2
          ctx.fillStyle = V.paletteAt(o.palette, m / half, 0.95)
          ctx.beginPath()
          ctx.roundRect(x, mid - h, bw, h, [bw / 2, bw / 2, 0, 0])
          ctx.fill()
        }
      }
    }
  )
})()
