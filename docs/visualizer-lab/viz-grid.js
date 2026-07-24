/* Grid / matrix visualizer styles. Pushes onto window.PRISM_VIZ. */
(() => {
  const V = window.VIZ

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
      id: 'dot-matrix',
      name: 'Dot Matrix',
      family: 'Grid',
      blurb: 'A board of dots that light column by column with the spectrum.',
      init: (s) => bands(s, 32),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cols = s.n
        const rows = 16
        const cw = W / cols
        const ch = H / rows
        const r = Math.min(cw, ch) * 0.3
        for (let i = 0; i < cols; i++) {
          const lit = Math.round(V.clamp(s.v[i], 0, 1) * rows)
          for (let j = 0; j < rows; j++) {
            const on = j < lit
            ctx.beginPath()
            ctx.arc((i + 0.5) * cw, H - (j + 0.5) * ch, on ? r : r * 0.5, 0, Math.PI * 2)
            ctx.fillStyle = on ? V.paletteAt(o.palette, j / (rows - 1)) : 'rgba(255,255,255,0.055)'
            ctx.fill()
          }
        }
      }
    },

    {
      id: 'led-wall',
      name: 'LED Wall',
      family: 'Grid',
      blurb: 'Square pixels on a dark wall, bright where the energy is.',
      init: (s) => bands(s, 28),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cols = s.n
        const rows = 14
        const cw = W / cols
        const ch = H / rows
        const pad = Math.min(cw, ch) * 0.16
        for (let i = 0; i < cols; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const lit = v * rows
          for (let j = 0; j < rows; j++) {
            const frac = V.clamp(lit - j, 0, 1)
            ctx.fillStyle =
              frac > 0.02
                ? V.paletteAt(o.palette, j / (rows - 1), 0.15 + frac * 0.85)
                : 'rgba(255,255,255,0.04)'
            ctx.fillRect(i * cw + pad, H - (j + 1) * ch + pad, cw - pad * 2, ch - pad * 2)
          }
        }
      }
    },

    {
      id: 'heat-grid',
      name: 'Heat Grid',
      family: 'Grid',
      blurb: 'A coarse grid coloured by how much energy sits in each cell.',
      init: (s) => bands(s, 24),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o, 0.7)
        const cols = 12
        const rows = 8
        const cw = W / cols
        const ch = H / rows
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const b = Math.floor(((i + j * cols) / (cols * rows)) * s.n)
            const v = V.clamp(s.v[Math.min(s.n - 1, b)], 0, 1)
            ctx.fillStyle = V.paletteAt(o.palette, v, 0.06 + v * 0.9)
            ctx.fillRect(i * cw + 1, j * ch + 1, cw - 2, ch - 2)
          }
        }
      }
    },

    {
      id: 'spectrogram',
      name: 'Spectrogram',
      family: 'Grid',
      blurb: 'A scrolling heat map: frequency up the side, time flowing left.',
      init(s, W, H) {
        bands(s, 128)
        s.off = document.createElement('canvas')
        s.off.width = Math.max(1, W)
        s.off.height = Math.max(1, H)
        s.octx = s.off.getContext('2d')
        s.octx.fillStyle = '#0b0d12'
        s.octx.fillRect(0, 0, W, H)
      },
      draw(ctx, W, H, d, o, s) {
        if (!s.octx) return
        upd(s, d, o)
        const col = Math.max(1, Math.round(2 * o.dpr))
        s.octx.globalCompositeOperation = 'copy'
        s.octx.drawImage(s.off, -col, 0)
        s.octx.globalCompositeOperation = 'source-over'
        s.octx.fillStyle = '#0b0d12'
        s.octx.fillRect(W - col, 0, col, H)
        const cellH = H / s.n
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          if (v <= 0.02) continue
          s.octx.fillStyle = V.paletteAt(o.palette, v, V.clamp(0.12 + v * 1.3, 0, 1))
          s.octx.fillRect(W - col, H - (i + 1) * cellH, col, Math.ceil(cellH) + 1)
        }
        ctx.drawImage(s.off, 0, 0)
      }
    },

    {
      id: 'tiles',
      name: 'Tile Field',
      family: 'Grid',
      blurb: 'Rounded tiles that scale up from their centres as bands fire.',
      init: (s) => bands(s, 40),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cols = 10
        const rows = 6
        const cw = W / cols
        const ch = H / rows
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const b = (i * rows + j) % s.n
            const v = V.clamp(s.v[b], 0, 1)
            const sz = Math.min(cw, ch) * (0.2 + v * 0.72)
            const cx = (i + 0.5) * cw
            const cy = (j + 0.5) * ch
            ctx.beginPath()
            ctx.roundRect(cx - sz / 2, cy - sz / 2, sz, sz, sz * 0.24)
            ctx.fillStyle = V.paletteAt(o.palette, b / (s.n - 1), 0.2 + v * 0.75)
            ctx.fill()
          }
        }
      }
    },

    {
      id: 'hex-grid',
      name: 'Hex Grid',
      family: 'Grid',
      blurb: 'A honeycomb where each cell answers to its own slice of the spectrum.',
      init: (s) => bands(s, 36),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cols = 11
        const rw = W / cols
        const rh = rw * 0.86
        const rows = Math.ceil(H / rh) + 1
        let idx = 0
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols + 1; i++) {
            const cx = i * rw + (j % 2 ? rw / 2 : 0)
            const cy = j * rh
            const v = V.clamp(s.v[idx++ % s.n], 0, 1)
            const r = rw * 0.46 * (0.35 + v * 0.75)
            ctx.beginPath()
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * Math.PI * 2 + Math.PI / 6
              const x = cx + Math.cos(a) * r
              const y = cy + Math.sin(a) * r
              if (k === 0) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            }
            ctx.closePath()
            ctx.fillStyle = V.paletteAt(o.palette, v, 0.1 + v * 0.8)
            ctx.fill()
          }
        }
      }
    },

    {
      id: 'bar-grid',
      name: 'Grid Bars',
      family: 'Grid',
      blurb: 'Rows of mini bar graphs, each row a slice of the spectrum.',
      init: (s) => bands(s, 48),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const rows = 6
        const per = Math.floor(s.n / rows)
        const rh = H / rows
        for (let r = 0; r < rows; r++) {
          for (let i = 0; i < per; i++) {
            const v = V.clamp(s.v[r * per + i], 0, 1)
            const bw = W / per
            const h = rh * 0.8 * v
            ctx.fillStyle = V.paletteAt(o.palette, (r * per + i) / (s.n - 1), 0.25 + v * 0.7)
            ctx.fillRect(i * bw + bw * 0.15, (r + 1) * rh - h - rh * 0.1, bw * 0.7, Math.max(o.dpr, h))
          }
        }
      }
    },

    {
      id: 'scan-lines',
      name: 'Scan Lines',
      family: 'Grid',
      blurb: 'Horizontal rules whose brightness tracks the spectrum, top to bottom.',
      init: (s) => bands(s, 44),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const lh = H / s.n
        for (let i = 0; i < s.n; i++) {
          const v = V.clamp(s.v[i], 0, 1)
          const y = H - (i + 1) * lh
          const w = W * (0.08 + v * 0.92)
          ctx.fillStyle = V.paletteAt(o.palette, i / (s.n - 1), 0.12 + v * 0.85)
          ctx.fillRect((W - w) / 2, y + lh * 0.2, w, Math.max(o.dpr, lh * 0.6))
        }
      }
    },

    {
      id: 'pixel-rain',
      name: 'Pixel Fall',
      family: 'Grid',
      blurb: 'Lit cells drift down the board, leaving a trail of the last beat.',
      init(s, W, H) {
        bands(s, 24)
        s.cols = 24
        s.rows = 16
        s.cells = new Float32Array(s.cols * s.rows)
        void W
        void H
      },
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        // shift everything down one row, then seed the top from the spectrum
        for (let j = s.rows - 1; j > 0; j--) {
          for (let i = 0; i < s.cols; i++) {
            s.cells[j * s.cols + i] = s.cells[(j - 1) * s.cols + i] * 0.93
          }
        }
        for (let i = 0; i < s.cols; i++) {
          s.cells[i] = V.clamp(s.v[i % s.n], 0, 1)
        }
        const cw = W / s.cols
        const ch = H / s.rows
        for (let j = 0; j < s.rows; j++) {
          for (let i = 0; i < s.cols; i++) {
            const v = s.cells[j * s.cols + i]
            if (v < 0.03) continue
            ctx.fillStyle = V.paletteAt(o.palette, i / (s.cols - 1), v)
            ctx.fillRect(i * cw + cw * 0.12, j * ch + ch * 0.12, cw * 0.76, ch * 0.76)
          }
        }
      }
    },

    {
      id: 'equaliser-wall',
      name: 'Equaliser Wall',
      family: 'Grid',
      blurb: 'A tall wall of narrow cells, the classic rack-mount look.',
      init: (s) => bands(s, 64),
      draw(ctx, W, H, d, o, s) {
        upd(s, d, o)
        const cols = s.n
        const rows = 26
        const cw = W / cols
        const ch = H / rows
        for (let i = 0; i < cols; i++) {
          const lit = V.clamp(s.v[i], 0, 1) * rows
          for (let j = 0; j < rows; j++) {
            const frac = V.clamp(lit - j, 0, 1)
            if (frac <= 0.02) {
              ctx.fillStyle = 'rgba(255,255,255,0.035)'
            } else {
              ctx.fillStyle = V.paletteAt(o.palette, j / (rows - 1), 0.25 + frac * 0.75)
            }
            ctx.fillRect(i * cw + cw * 0.18, H - (j + 1) * ch + ch * 0.18, cw * 0.64, ch * 0.64)
          }
        }
      }
    }
  )
})()
