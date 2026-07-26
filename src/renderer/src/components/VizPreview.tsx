import { useEffect, useRef, type JSX } from 'react'
import { clamp, type AudioFrame, type DrawFn, type VizOpts, type VizTheme } from '../lib/viz/core'
import { styleById } from '../lib/viz/styles'

// A small, STATIC but accurate preview of a visualizer style. It runs the real
// style draw function over a short synthetic warm-up (so trail-based styles build
// up and every style lands on a representative frame), then freezes — no ongoing
// animation. Reusing the real draw functions means a preview can never drift from
// the actual visualizer. Re-renders on resize so it stays crisp.

const WARMUP = 100 // frames rendered to settle the image, then it holds

// A lively, music-like spectrum + waveform. The key is that every band oscillates
// at its OWN rate (desynced), so when the image freezes the bands land at
// scattered heights instead of all equal - the bar styles adaptively normalise
// each band to its own recent peak, so a uniform input would read as one flat
// bar. A static spatial contour (deep valleys) adds contrast for the styles that
// don't normalise. No audio, no analyser.
function synth(freq: Uint8Array, time: Uint8Array, t: number): void {
  const n = freq.length
  for (let i = 0; i < n; i++) {
    const norm = i / n
    const env = Math.pow(1 - norm, 0.7) // gentle overall roll-off
    // per-band oscillation whose temporal frequency varies with i -> bands drift
    // out of phase and freeze at different points in their cycle.
    const osc = 0.5 + 0.5 * Math.sin(t * (0.0016 + 0.000055 * i) + i * 0.9)
    // static spectral contour: peaks and deep valleys across the band.
    const contour = Math.pow(0.5 + 0.5 * Math.sin(i * 0.3) * Math.cos(i * 0.11 + 0.7), 2)
    let v = env * (0.18 + 0.82 * contour) * (0.35 + 0.65 * osc)
    if (norm < 0.12) v += 0.5 * (0.55 + 0.45 * Math.sin(t * 0.005)) // pumping bass
    freq[i] = clamp(Math.round(v * 255 * 1.3), 0, 255)
  }
  for (let i = 0; i < time.length; i++) {
    const s =
      0.55 * Math.sin(i * 0.05 + t * 0.02) +
      0.3 * Math.sin(i * 0.021 + t * 0.006) +
      0.15 * Math.sin(i * 0.13 + t * 0.03)
    time[i] = clamp(Math.round(128 + 82 * s), 0, 255)
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
        synth(freq, time, t)
        if (ampScale !== 1) for (let i = 0; i < freq.length; i++) freq[i] = freq[i] * ampScale
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
