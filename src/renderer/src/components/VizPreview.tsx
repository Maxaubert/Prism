import { useEffect, useRef, type JSX } from 'react'
import { clamp, type AudioFrame, type DrawFn, type VizOpts, type VizTheme } from '../lib/viz/core'
import { styleById } from '../lib/viz/styles'

// A small, STATIC but accurate preview of a visualizer style. It runs the real
// style draw function over a short synthetic warm-up (so trail-based styles build
// up and every style lands on a representative frame), then freezes — no ongoing
// animation. Reusing the real draw functions means a preview can never drift from
// the actual visualizer. Re-renders on resize so it stays crisp.

const WARMUP = 100 // frames rendered to settle the image, then it holds

// A fixed, music-like spectrum. The bars average freq over LOG-spaced bin ranges,
// so the jaggedness has to live in log-frequency space or it averages away to a
// flat row (varying per bin is invisible once each bar averages its range). We
// build the contour from log(bin) so adjacent BARS land at different heights,
// over a natural bass-heavy roll-off. Bar height is mostly absolute (see
// makeBands), so this static spectrum reads as a lively, varied frame.
function synth(freq: Uint8Array, time: Uint8Array): void {
  const n = freq.length
  for (let i = 0; i < n; i++) {
    const lb = Math.log(i + 3) // ~1.1 (bass) .. ~6.9 (treble)
    // layered waves in log-frequency: distinct height per bar, not per bin.
    const jag =
      0.5 +
      0.5 * (0.44 * Math.sin(lb * 3.3 + 0.5) + 0.32 * Math.sin(lb * 6.1 + 2.1) + 0.24 * Math.sin(lb * 9.4 + 4.0))
    const env = Math.pow(1 - i / n, 0.55) // bass louder, tapering to treble
    const v = clamp((0.3 + 0.7 * env) * clamp(jag, 0, 1), 0.02, 1)
    freq[i] = clamp(Math.round(v * 255), 0, 255)
  }
  for (let i = 0; i < time.length; i++) {
    const s = 0.5 * Math.sin(i * 0.05) + 0.3 * Math.sin(i * 0.021 + 1.5) + 0.2 * Math.sin(i * 0.13 + 3)
    time[i] = clamp(Math.round(128 + 80 * s), 0, 255)
  }
}

function band(freq: Uint8Array, from: number, to: number): number {
  let s = 0
  let c = 0
  for (let i = from; i < to && i < freq.length; i++) {
    s += freq[i]
    c++
  }
  return c ? s / c / 255 : 0
}

// These styles need the whole frame (radial rings, and the continuous liquid
// band); everything else is a left-to-right bar shape we render wide and crop, so
// bars read thick and few instead of the full fullscreen count crammed in.
const RADIAL = new Set(['ripples', 'outline-round', 'solid-round', 'liquid'])
const ZOOM = 2.6 // how much wider than the box a bar style is rendered before cropping

export function VizPreview({ styleId, theme }: { styleId: string; theme: VizTheme }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const freq = new Uint8Array(1024)
    const time = new Uint8Array(2048).fill(128)
    const frame: AudioFrame = {
      freq, time, bass: 0, mid: 0, treble: 0, level: 0, beat: 0, drop: 0,
      t: 0, playing: true, sampleRate: 44100
    }
    const opts: VizOpts = { accent: theme.accent, palette: theme.palette, sensitivity: 1, dpr: 1 }
    const smoothBuf = new Float32Array(freq.length) // scratch for the Caps blur
    // Off-screen canvas the style actually draws into (wider than the box for bar
    // styles), then the centre is cropped onto the visible canvas.
    const off = document.createElement('canvas')
    const octx = off.getContext('2d')
    if (!octx) return

    const paint = (): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      const W = Math.round(rect.width * dpr)
      const H = Math.round(rect.height * dpr)
      if (W <= 0 || H <= 0) return
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W
        canvas.height = H
      }
      const radial = RADIAL.has(styleId)
      // Whole-frame styles are supersampled (crisp thin lines when downscaled);
      // bar styles are rendered wide and cropped so bars read thick and few.
      const ss = radial ? 2 : 1
      // The ring packs ~150 rays; at thumbnail size long rays merge into a solid
      // ball, so shorten them to keep a delicate ring outline.
      const ampScale = styleId === 'ripples' ? 0.5 : 1
      const OW = radial ? W * ss : Math.round(W * ZOOM)
      const OH = H * ss
      if (off.width !== OW || off.height !== OH) {
        off.width = OW
        off.height = OH
      }
      const style = styleById(styleId)
      const draw: DrawFn = style.create(OW, OH)

      opts.palette = theme.palette
      opts.accent = theme.accent
      opts.vgrad = theme.vgrad ?? null
      opts.cycle = theme.cycle ?? null
      opts.dropStyle = 1
      opts.previewBurst = 0
      opts.dpr = dpr

      octx.clearRect(0, 0, OW, OH)
      // Warm up over a few synthetic frames, then stop on the last one.
      for (let f = 0; f <= WARMUP; f++) {
        const t = f * 16
        synth(freq, time)
        if (ampScale !== 1) for (let i = 0; i < freq.length; i++) freq[i] = freq[i] * ampScale
        if (styleId === 'mirror-caps') {
          // Caps couples neighbours into a smooth envelope, so a jagged spectrum
          // reads as noise. Heavily blur it to a gentle hill of caps.
          const R = 12
          const N = freq.length
          for (let pass = 0; pass < 3; pass++) {
            for (let i = 0; i < N; i++) {
              let s = 0
              let c = 0
              for (let k = -R; k <= R; k++) {
                const j = i + k
                if (j >= 0 && j < N) {
                  s += freq[j]
                  c++
                }
              }
              smoothBuf[i] = s / c
            }
            for (let i = 0; i < N; i++) freq[i] = smoothBuf[i]
          }
        }
        frame.t = t
        frame.playing = true
        frame.bass = band(freq, 0, 40)
        frame.mid = band(freq, 40, 300)
        frame.treble = band(freq, 300, 700)
        frame.level = 0.62 + 0.22 * Math.sin(t * 0.002)
        frame.beat = Math.max(0, Math.sin(t * 0.003)) * 0.7
        frame.drop = 0

        if (style.trails) {
          octx.fillStyle = 'rgba(13,15,20,0.25)'
          octx.fillRect(0, 0, OW, OH)
        } else {
          octx.clearRect(0, 0, OW, OH)
        }
        octx.save()
        if (theme.alpha != null) octx.globalAlpha = theme.alpha
        // No glow in previews: it blooms rings into a solid ball and washes out
        // bar shapes. Colour/glow is chosen separately; the picker shows shape.
        try {
          draw(octx, OW, OH, frame, opts)
        } catch {
          break
        }
        octx.restore()
      }

      ctx.clearRect(0, 0, W, H)
      if (radial) {
        // Downscale the supersampled render for crisp, thin lines.
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(off, 0, 0, OW, OH, 0, 0, W, H)
      } else {
        // Crop the centre of the wider render 1:1, so bars keep their thicker
        // off-screen width instead of being scaled back down.
        const sx = Math.round((OW - W) / 2)
        ctx.drawImage(off, sx, 0, W, H, 0, 0, W, H)
      }
    }

    // Paint once laid out, and re-paint (still static) whenever the box resizes.
    const ro = new ResizeObserver(() => paint())
    ro.observe(canvas)
    paint()
    return () => ro.disconnect()
  }, [styleId, theme])

  return <canvas ref={ref} className="h-full w-full" style={{ background: '#0d0f14' }} />
}
