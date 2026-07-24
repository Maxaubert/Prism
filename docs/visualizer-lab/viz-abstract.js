/* Abstract / scene visualizer styles. Pushes onto window.PRISM_VIZ. */
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
      id: 'tunnel',
      name: 'Tunnel',
      family: 'Abstract',
      blurb: 'Rings rushing toward you, one released on every beat.',
      trails: true,
      init(s) {
        bands(s, 16)
        s.rings = []
        for (let i = 0; i < 14; i++) s.rings.push({ z: i / 14 })
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const speed = 0.004 + d.level * 0.012 * o.sensitivity
        for (let i = 0; i < s.rings.length; i++) {
          const r = s.rings[i]
          r.z += speed
          if (r.z > 1) r.z -= 1
          const persp = Math.pow(r.z, 2.2)
          const rad = persp * minD * 0.62
          const band = V.clamp(s.v[i % s.n], 0, 1)
          const sides = 7
          ctx.beginPath()
          for (let k = 0; k <= sides; k++) {
            const a = (k / sides) * TAU + r.z * 0.8
            const rr = rad * (1 + band * 0.16)
            const x = cx + Math.cos(a) * rr
            const y = cy + Math.sin(a) * rr
            if (k === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.closePath()
          ctx.strokeStyle = V.paletteAt(o.palette, 1 - r.z, V.clamp(r.z * 1.2, 0, 0.9))
          ctx.lineWidth = Math.max(1, minD * 0.006 * r.z)
          ctx.stroke()
        }
      }
    },

    {
      id: 'terrain',
      name: 'Ridge Terrain',
      family: 'Abstract',
      blurb: 'Mountain ridges built from the spectrum, receding into haze.',
      init(s) {
        bands(s, 48)
        s.rows = []
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        s.rows.unshift(Float32Array.from(s.v))
        if (s.rows.length > 14) s.rows.pop()
        for (let r = s.rows.length - 1; r >= 0; r--) {
          const row = s.rows[r]
          const t = r / 14
          const yBase = H * (0.42 + t * 0.5)
          const amp = H * 0.2 * (1 - t * 0.55)
          ctx.beginPath()
          ctx.moveTo(0, H)
          for (let i = 0; i < row.length; i++) {
            const x = (i / (row.length - 1)) * W
            ctx.lineTo(x, yBase - V.clamp(row[i], 0, 1) * amp)
          }
          ctx.lineTo(W, H)
          ctx.closePath()
          ctx.fillStyle = V.paletteAt(o.palette, 1 - t, 0.9 - t * 0.75)
          ctx.fill()
          ctx.strokeStyle = V.paletteAt(o.palette, 1 - t, 0.9 - t * 0.5)
          ctx.lineWidth = Math.max(1, o.dpr)
          ctx.stroke()
        }
      }
    },

    {
      id: 'aurora',
      name: 'Aurora',
      family: 'Abstract',
      blurb: 'Slow sheets of light drifting like the northern sky.',
      init(s) {
        bands(s, 12)
        s.ph = 0
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.5)
        s.ph += 0.004 + d.level * 0.01
        const layers = 5
        ctx.globalCompositeOperation = 'lighter'
        for (let L = 0; L < layers; L++) {
          const t = L / (layers - 1)
          const v = V.clamp(s.v[L * 2] || 0, 0, 1)
          const amp = H * (0.05 + v * 0.16)
          const yb = H * (0.3 + t * 0.35)
          ctx.beginPath()
          ctx.moveTo(0, H)
          for (let i = 0; i <= 60; i++) {
            const u = i / 60
            const y =
              yb +
              Math.sin(u * 4.2 + s.ph * (1 + t) + t * 2) * amp +
              Math.sin(u * 9.1 - s.ph * 1.4) * amp * 0.4
            ctx.lineTo(u * W, y)
          }
          ctx.lineTo(W, H)
          ctx.closePath()
          const g = ctx.createLinearGradient(0, yb - amp, 0, H)
          g.addColorStop(0, V.paletteAt(o.palette, t, 0.32))
          g.addColorStop(1, V.paletteAt(o.palette, t, 0))
          ctx.fillStyle = g
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    },

    {
      id: 'kaleidoscope',
      name: 'Kaleidoscope',
      family: 'Abstract',
      blurb: 'One spectrum wedge mirrored around the circle into a symmetric figure.',
      init: (s) => bands(s, 28),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const wedges = 10
        const spin = (d.t / 1000) * 0.08
        for (let w = 0; w < wedges; w++) {
          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate((w / wedges) * TAU + spin)
          if (w % 2) ctx.scale(1, -1)
          ctx.beginPath()
          ctx.moveTo(0, 0)
          for (let i = 0; i < s.n; i++) {
            const v = V.clamp(s.v[i], 0, 1)
            const a = (i / s.n) * (TAU / wedges)
            const r = minD * (0.06 + v * 0.34)
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
          }
          ctx.closePath()
          ctx.fillStyle = V.paletteAt(o.palette, w / wedges, 0.35)
          ctx.fill()
          ctx.restore()
        }
      }
    },

    {
      id: 'plasma',
      name: 'Plasma',
      family: 'Abstract',
      blurb: 'Soft coloured blobs that swell and merge with the low end.',
      init(s) {
        bands(s, 8)
        s.ph = 0
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.5)
        s.ph += 0.006 + d.level * 0.012
        const minD = Math.min(W, H)
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const a = (i / s.n) * TAU + s.ph * (1 + i * 0.1)
          const x = W / 2 + Math.cos(a) * W * 0.24
          const y = H / 2 + Math.sin(a * 1.3) * H * 0.24
          const r = minD * (0.08 + v * 0.22)
          const g = ctx.createRadialGradient(x, y, 0, x, y, r)
          g.addColorStop(0, V.paletteAt(o.palette, i / (s.n - 1), 0.4 + v * 0.35))
          g.addColorStop(1, V.paletteAt(o.palette, i / (s.n - 1), 0))
          ctx.beginPath()
          ctx.arc(x, y, r, 0, TAU)
          ctx.fillStyle = g
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    },

    {
      id: 'mandala',
      name: 'Mandala',
      family: 'Abstract',
      blurb: 'Rotating rings of petals, each ring keyed to a different band.',
      init: (s) => bands(s, 6),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.6)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const t = d.t / 1000
        for (let ring = 0; ring < s.n; ring++) {
          const v = V.clamp(s.v[ring], 0, 1)
          const count = 6 + ring * 3
          const R = minD * (0.07 + ring * 0.055)
          const rad = minD * (0.012 + v * 0.028)
          const spin = t * (ring % 2 ? 0.12 : -0.12)
          for (let i = 0; i < count; i++) {
            const a = (i / count) * TAU + spin
            ctx.beginPath()
            ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, rad, 0, TAU)
            ctx.strokeStyle = V.paletteAt(o.palette, ring / (s.n - 1), 0.25 + v * 0.7)
            ctx.lineWidth = Math.max(1, minD * 0.0025)
            ctx.stroke()
          }
        }
      }
    },

    {
      id: 'moire',
      name: 'Moire',
      family: 'Abstract',
      blurb: 'Two ring patterns sliding across each other into interference.',
      init: (s) => bands(s, 4),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.5)
        const minD = Math.min(W, H)
        const sep = minD * (0.03 + V.clamp(s.v[0], 0, 1) * 0.16)
        const rings = 26
        ctx.lineWidth = Math.max(1, o.dpr)
        for (let c = 0; c < 2; c++) {
          const cx = W / 2 + (c ? sep : -sep)
          const cy = H / 2
          for (let i = 1; i <= rings; i++) {
            ctx.beginPath()
            ctx.arc(cx, cy, (i / rings) * minD * 0.46, 0, TAU)
            ctx.strokeStyle = V.paletteAt(o.palette, c ? 0.85 : 0.15, 0.3)
            ctx.stroke()
          }
        }
      }
    },

    {
      id: 'lissajous',
      name: 'Lissajous',
      family: 'Abstract',
      blurb: 'A harmonograph figure whose frequencies drift with mids and highs.',
      trails: true,
      init(s) {
        s.ph = 0
        s.fa = 3
        s.fb = 2
      },
      draw(ctx, W, H, d, o, s) {
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const R = minD * 0.36
        s.fa += (2 + d.mid * 3 - s.fa) * 0.01
        s.fb += (3 + d.treble * 3 - s.fb) * 0.01
        const amp = 0.55 + d.level * 0.3 * o.sensitivity
        let px = null
        let py = null
        for (let k = 0; k < 8; k++) {
          s.ph += 0.0035
          const x = cx + Math.sin(s.ph * s.fa) * R * amp
          const y = cy + Math.sin(s.ph * s.fb + 1.1) * R * amp
          if (px != null) {
            ctx.beginPath()
            ctx.moveTo(px, py)
            ctx.lineTo(x, y)
            ctx.strokeStyle = V.paletteAt(o.palette, (Math.sin(s.ph) + 1) / 2, 0.9)
            ctx.lineWidth = Math.max(1.2, minD * 0.003)
            ctx.stroke()
          }
          px = x
          py = y
        }
      }
    },

    {
      id: 'ribbons-3d',
      name: 'Ribbons',
      family: 'Abstract',
      blurb: 'Long ribbons rolling across the frame, twisting with the mids.',
      init(s) {
        bands(s, 10)
        s.ph = 0
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.6)
        s.ph += 0.008 + d.level * 0.02
        const count = 5
        for (let r = 0; r < count; r++) {
          const t = r / (count - 1)
          const v = V.clamp(s.v[r * 2] || 0, 0, 1)
          const amp = H * (0.06 + v * 0.16)
          const yb = H * (0.25 + t * 0.5)
          ctx.beginPath()
          for (let i = 0; i <= 80; i++) {
            const u = i / 80
            const y = yb + Math.sin(u * 5 + s.ph + t * 3) * amp
            if (i === 0) ctx.moveTo(0, y)
            else ctx.lineTo(u * W, y)
          }
          for (let i = 80; i >= 0; i--) {
            const u = i / 80
            const thick = H * 0.012 * (0.4 + Math.abs(Math.sin(u * 3 + s.ph)) * 1.2)
            const y = yb + Math.sin(u * 5 + s.ph + t * 3) * amp + thick
            ctx.lineTo(u * W, y)
          }
          ctx.closePath()
          ctx.fillStyle = V.paletteAt(o.palette, t, 0.55)
          ctx.fill()
        }
      }
    },

    {
      id: 'horizon',
      name: 'Horizon',
      family: 'Abstract',
      blurb: 'A sun on the horizon with a spectrum skyline and a mirrored reflection.',
      init: (s) => bands(s, 40),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const minD = Math.min(W, H)
        const hz = H * 0.62
        const sunR = minD * (0.14 + d.bass * 0.05)
        const g = ctx.createRadialGradient(W / 2, hz, 0, W / 2, hz, sunR)
        g.addColorStop(0, V.paletteAt(o.palette, 0.9, 0.85))
        g.addColorStop(1, V.paletteAt(o.palette, 0.4, 0.05))
        ctx.beginPath()
        ctx.arc(W / 2, hz, sunR, 0, TAU)
        ctx.fillStyle = g
        ctx.fill()

        const slot = W / s.n
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const h = v * H * 0.3
          const x = i * slot
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.9)
          ctx.fillRect(x + slot * 0.12, hz - h, slot * 0.76, h)
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.16)
          ctx.fillRect(x + slot * 0.12, hz, slot * 0.76, h * 0.7)
        }
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        ctx.fillRect(0, hz - o.dpr / 2, W, o.dpr)
      }
    }
  )
})()
