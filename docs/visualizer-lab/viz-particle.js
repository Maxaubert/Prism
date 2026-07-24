/* Particle-family visualizer styles. Pushes onto window.PRISM_VIZ. */
(() => {
  const V = window.VIZ
  const TAU = Math.PI * 2

  function bands(s, n) {
    s.n = n
    s.ranges = V.bandRanges(n)
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
    {
      id: 'starfield',
      name: 'Starfield',
      family: 'Particle',
      blurb: 'Stars streaming past, accelerating on every kick.',
      trails: true,
      init(s) {
        s.p = []
        for (let i = 0; i < 220; i++) {
          s.p.push({ a: rnd(i) * TAU, r: rnd(i + 99) * 0.5 + 0.02, sp: 0.4 + rnd(i + 7) * 1.2 })
        }
      },
      draw(ctx, W, H, d, o, s) {
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const boost = 1 + d.beat * 5 + d.level * 3 * o.sensitivity
        for (let i = 0; i < s.p.length; i++) {
          const p = s.p[i]
          p.r += 0.0016 * p.sp * boost
          if (p.r > 0.62) {
            p.r = 0.02
            p.a = rnd(i + Math.floor(d.t)) * TAU
          }
          const x = cx + Math.cos(p.a) * p.r * minD
          const y = cy + Math.sin(p.a) * p.r * minD
          const sz = Math.max(o.dpr * 0.6, p.r * minD * 0.014)
          ctx.beginPath()
          ctx.arc(x, y, sz, 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, p.r * 1.6, V.clamp(p.r * 2.2, 0.1, 1))
          ctx.fill()
        }
      }
    },

    {
      id: 'fountain',
      name: 'Fountain',
      family: 'Particle',
      blurb: 'Sparks thrown up from the floor by the beat, falling back under gravity.',
      trails: true,
      init(s) {
        s.p = []
        s.armed = true
      },
      draw(ctx, W, H, d, o, s) {
        const minD = Math.min(W, H)
        if (d.beat > 0.45 && s.armed) {
          const count = 14 + Math.floor(d.beat * 26)
          for (let i = 0; i < count; i++) {
            s.p.push({
              x: W / 2 + (rnd(i + d.t) - 0.5) * W * 0.1,
              y: H * 0.92,
              vx: (rnd(i + 3) - 0.5) * minD * 0.011,
              vy: -minD * (0.012 + rnd(i + 11) * 0.014) * (0.6 + d.beat),
              life: 1,
              c: rnd(i + 5)
            })
          }
          s.armed = false
        }
        if (d.beat < 0.2) s.armed = true
        if (s.p.length > 700) s.p.splice(0, s.p.length - 700)

        for (let i = s.p.length - 1; i >= 0; i--) {
          const p = s.p[i]
          p.vy += minD * 0.00045
          p.x += p.vx
          p.y += p.vy
          p.life -= 0.009
          if (p.life <= 0 || p.y > H) {
            s.p.splice(i, 1)
            continue
          }
          ctx.beginPath()
          ctx.arc(p.x, p.y, Math.max(o.dpr, minD * 0.005 * p.life), 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, p.c, p.life)
          ctx.fill()
        }
      }
    },

    {
      id: 'fireflies',
      name: 'Fireflies',
      family: 'Particle',
      blurb: 'Slow drifting lights that flare in time with their own band.',
      init(s) {
        bands(s, 20)
        s.p = []
        for (let i = 0; i < 90; i++) {
          s.p.push({ x: rnd(i), y: rnd(i + 51), b: i % 20, ph: rnd(i + 13) * TAU })
        }
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.7)
        const minD = Math.min(W, H)
        const t = d.t / 1000
        for (let i = 0; i < s.p.length; i++) {
          const p = s.p[i]
          const v = V.clamp(s.v[p.b], 0, 1)
          const x = (p.x + Math.sin(t * 0.12 + p.ph) * 0.03) * W
          const y = (p.y + Math.cos(t * 0.09 + p.ph * 1.7) * 0.03) * H
          const r = minD * (0.004 + v * 0.016)
          const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3)
          g.addColorStop(0, V.paletteAt(o.palette, p.b / 19, 0.15 + v * 0.85))
          g.addColorStop(1, V.paletteAt(o.palette, p.b / 19, 0))
          ctx.beginPath()
          ctx.arc(x, y, r * 3, 0, TAU)
          ctx.fillStyle = g
          ctx.fill()
        }
      }
    },

    {
      id: 'rain',
      name: 'Rainfall',
      family: 'Particle',
      blurb: 'Streaks falling faster and thicker as the track gets louder.',
      trails: true,
      init(s) {
        s.p = []
        for (let i = 0; i < 160; i++) {
          s.p.push({ x: rnd(i), y: rnd(i + 31), sp: 0.4 + rnd(i + 5) * 1.1, len: 0.02 + rnd(i + 9) * 0.05 })
        }
      },
      draw(ctx, W, H, d, o, s) {
        const speed = 0.006 * (0.5 + d.level * 4 * o.sensitivity)
        ctx.lineCap = 'round'
        for (let i = 0; i < s.p.length; i++) {
          const p = s.p[i]
          p.y += speed * p.sp
          if (p.y > 1.1) {
            p.y = -0.1
            p.x = rnd(i + Math.floor(d.t / 100))
          }
          const x = p.x * W
          const y = p.y * H
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x, y + p.len * H)
          ctx.strokeStyle = V.paletteAt(o.palette, p.x, 0.2 + d.level * 1.6)
          ctx.lineWidth = Math.max(1, o.dpr * (0.7 + p.sp))
          ctx.stroke()
        }
      }
    },

    {
      id: 'swarm',
      name: 'Swarm',
      family: 'Particle',
      blurb: 'A cloud that contracts on the beat and breathes back out.',
      init(s) {
        bands(s, 16)
        s.p = []
        for (let i = 0; i < 200; i++) {
          s.p.push({ a: rnd(i) * TAU, r: 0.15 + rnd(i + 41) * 0.28, b: i % 16, ph: rnd(i + 7) * TAU })
        }
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        const t = d.t / 1000
        const pull = 1 - d.beat * 0.28
        for (let i = 0; i < s.p.length; i++) {
          const p = s.p[i]
          const v = V.clamp(s.v[p.b], 0, 1)
          const a = p.a + t * 0.1 + Math.sin(t * 0.5 + p.ph) * 0.2
          const r = (p.r * pull + v * 0.07) * minD
          ctx.beginPath()
          ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85, Math.max(o.dpr, minD * (0.002 + v * 0.007)), 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, p.b / 15, 0.25 + v * 0.75)
          ctx.fill()
        }
      }
    },

    {
      id: 'confetti',
      name: 'Confetti',
      family: 'Particle',
      blurb: 'Flat chips tumbling down, kicked sideways by transients.',
      trails: false,
      init(s) {
        s.p = []
        for (let i = 0; i < 140; i++) {
          s.p.push({ x: rnd(i), y: rnd(i + 17), rot: rnd(i + 3) * TAU, sp: 0.5 + rnd(i + 8), c: rnd(i + 21) })
        }
      },
      draw(ctx, W, H, d, o, s) {
        const minD = Math.min(W, H)
        const fall = 0.0022 * (0.6 + d.level * 3 * o.sensitivity)
        for (let i = 0; i < s.p.length; i++) {
          const p = s.p[i]
          p.y += fall * p.sp
          p.rot += 0.03 * p.sp + d.beat * 0.12
          p.x += Math.sin(p.rot) * 0.0016
          if (p.y > 1.08) {
            p.y = -0.08
            p.x = rnd(i + Math.floor(d.t / 90))
          }
          const w = minD * 0.014
          const h = minD * 0.007
          ctx.save()
          ctx.translate(p.x * W, p.y * H)
          ctx.rotate(p.rot)
          ctx.fillStyle = V.paletteAt(o.palette, p.c, 0.85)
          ctx.fillRect(-w / 2, -h / 2, w, h * (0.4 + Math.abs(Math.cos(p.rot)) * 0.6))
          ctx.restore()
        }
      }
    },

    {
      id: 'gravity-dots',
      name: 'Gravity Well',
      family: 'Particle',
      blurb: 'Dots orbiting a well that deepens with the bass.',
      trails: true,
      init(s) {
        s.p = []
        for (let i = 0; i < 130; i++) {
          const a = rnd(i) * TAU
          const r = 0.12 + rnd(i + 61) * 0.3
          s.p.push({ a, r, vr: 0, c: rnd(i + 5) })
        }
      },
      draw(ctx, W, H, d, o, s) {
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        for (let i = 0; i < s.p.length; i++) {
          const p = s.p[i]
          // bass pulls inward, beats push out
          p.vr += (0.26 - p.r) * 0.002 - d.bass * 0.0016 + d.beat * 0.004
          p.vr *= 0.96
          p.r = V.clamp(p.r + p.vr, 0.05, 0.55)
          p.a += 0.004 + (0.3 - p.r) * 0.02
          ctx.beginPath()
          ctx.arc(cx + Math.cos(p.a) * p.r * minD, cy + Math.sin(p.a) * p.r * minD, Math.max(o.dpr, minD * 0.004), 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, p.c, 0.75)
          ctx.fill()
        }
      }
    },

    {
      id: 'spark-burst',
      name: 'Spark Burst',
      family: 'Particle',
      blurb: 'Every kick throws a ring of sparks that fly out and die.',
      trails: true,
      init(s) {
        s.p = []
        s.armed = true
      },
      draw(ctx, W, H, d, o, s) {
        const cx = W / 2
        const cy = H / 2
        const minD = Math.min(W, H)
        if (d.beat > 0.5 && s.armed) {
          const count = 26
          for (let i = 0; i < count; i++) {
            const a = (i / count) * TAU + rnd(i + d.t) * 0.2
            s.p.push({ x: cx, y: cy, vx: Math.cos(a) * minD * 0.011, vy: Math.sin(a) * minD * 0.011, life: 1, c: i / count })
          }
          s.armed = false
        }
        if (d.beat < 0.22) s.armed = true
        if (s.p.length > 500) s.p.splice(0, s.p.length - 500)

        for (let i = s.p.length - 1; i >= 0; i--) {
          const p = s.p[i]
          p.x += p.vx
          p.y += p.vy
          p.vx *= 0.975
          p.vy *= 0.975
          p.life -= 0.016
          if (p.life <= 0) {
            s.p.splice(i, 1)
            continue
          }
          ctx.beginPath()
          ctx.arc(p.x, p.y, Math.max(o.dpr, minD * 0.005 * p.life), 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, p.c, p.life)
          ctx.fill()
        }
      }
    },

    {
      id: 'band-columns',
      name: 'Rising Motes',
      family: 'Particle',
      blurb: 'Motes lifted off each band and carried upward as it plays.',
      trails: false,
      init(s) {
        bands(s, 20)
        s.p = []
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const minD = Math.min(W, H)
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          if (v > 0.3 && s.p.length < 500 && Math.random() < v * 0.5) {
            s.p.push({ x: (i + 0.5) / s.n, y: 1, v, life: 1, b: i })
          }
        }
        for (let i = s.p.length - 1; i >= 0; i--) {
          const p = s.p[i]
          p.y -= 0.004 + p.v * 0.006
          p.life -= 0.008
          if (p.life <= 0 || p.y < -0.05) {
            s.p.splice(i, 1)
            continue
          }
          ctx.beginPath()
          ctx.arc(p.x * W, p.y * H, Math.max(o.dpr, minD * 0.004 * p.life), 0, TAU)
          ctx.fillStyle = V.paletteAt(o.palette, p.b / (s.n - 1), p.life * 0.9)
          ctx.fill()
        }
      }
    }
  )
})()
