import { useEffect, useRef, type JSX } from 'react'
import { clamp, type AudioFrame, type DrawFn, type VizOpts, type VizTheme } from '../lib/viz/core'
import { styleById } from '../lib/viz/styles'

// A small, STATIC but accurate preview of a visualizer style. It runs the real
// style draw function over a short synthetic warm-up (so trail-based styles build
// up and every style lands on a representative frame), then freezes — no ongoing
// animation. Reusing the real draw functions means a preview can never drift from
// the actual visualizer. Re-renders on resize so it stays crisp.

const WARMUP = 40 // frames rendered to settle the image, then it holds

// A full, music-like spectrum + waveform so each style shows its characteristic
// form (a strong bass end, spiky mids, a rolled-off top). No audio, no analyser —
// tuned high enough that ring/liquid styles read as boldly as the bar ones.
function synth(freq: Uint8Array, time: Uint8Array, t: number): void {
  const beat = 0.7 + 0.3 * Math.sin(t * 0.0022)
  const n = freq.length
  for (let i = 0; i < n; i++) {
    const norm = i / n
    const env = Math.pow(1 - norm, 1.1) // fuller across the band
    const wob = 0.5 + 0.5 * Math.sin(t * 0.005 + i * 0.22) * Math.cos(t * 0.0021 + i * 0.07)
    const spike = 0.28 * Math.max(0, Math.sin(i * 0.55 + t * 0.004)) // per-bin detail
    const bass = norm < 0.14 ? 0.7 * beat : 0
    freq[i] = clamp(Math.round((env * (0.45 + 0.55 * wob) + spike + bass) * 250), 0, 255)
  }
  const amp = 62 * (0.6 + 0.4 * beat)
  for (let i = 0; i < time.length; i++) {
    time[i] = clamp(Math.round(128 + amp * Math.sin(t * 0.02 + i * 0.05) * Math.sin(t * 0.001 + i * 0.002)), 0, 255)
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

// Radial ring styles need the whole square frame; everything else is a
// left-to-right bar shape we can render wide and crop, so bars read thick and few
// instead of the full fullscreen count crammed into a short box.
const RADIAL = new Set(['ripples', 'outline-round', 'solid-round'])
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
      const OW = radial ? W : Math.round(W * ZOOM) // render width
      if (off.width !== OW || off.height !== H) {
        off.width = OW
        off.height = H
      }
      const style = styleById(styleId)
      const draw: DrawFn = style.create(OW, H)

      opts.palette = theme.palette
      opts.accent = theme.accent
      opts.vgrad = theme.vgrad ?? null
      opts.cycle = theme.cycle ?? null
      opts.dropStyle = 1
      opts.previewBurst = 0
      opts.dpr = dpr

      octx.clearRect(0, 0, OW, H)
      // Warm up over a few synthetic frames, then stop on the last one.
      for (let f = 0; f <= WARMUP; f++) {
        const t = f * 16
        synth(freq, time, t)
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
          octx.fillRect(0, 0, OW, H)
        } else {
          octx.clearRect(0, 0, OW, H)
        }
        octx.save()
        if (theme.alpha != null) octx.globalAlpha = theme.alpha
        // No glow in previews: it blooms rings into a solid ball and washes out
        // bar shapes. Colour/glow is chosen separately; the picker shows shape.
        try {
          draw(octx, OW, H, frame, opts)
        } catch {
          break
        }
        octx.restore()
      }

      // Crop the centre of the (wider) render onto the visible canvas 1:1, so bars
      // keep their thicker off-screen width instead of being scaled back down.
      ctx.clearRect(0, 0, W, H)
      const sx = Math.round((OW - W) / 2)
      ctx.drawImage(off, sx, 0, W, H, 0, 0, W, H)
    }

    // Paint once laid out, and re-paint (still static) whenever the box resizes.
    const ro = new ResizeObserver(() => paint())
    ro.observe(canvas)
    paint()
    return () => ro.disconnect()
  }, [styleId, theme])

  return <canvas ref={ref} className="h-full w-full" style={{ background: '#0d0f14' }} />
}
