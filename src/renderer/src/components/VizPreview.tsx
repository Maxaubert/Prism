import { useEffect, useRef, type JSX } from 'react'
import { clamp, type AudioFrame, type DrawFn, type VizOpts, type VizTheme } from '../lib/viz/core'
import { styleById } from '../lib/viz/styles'

// A small, STATIC but accurate preview of a visualizer style: it runs the real
// style draw over a short synthetic warm-up (so the style's own smoothing settles
// and trail styles build up), then freezes. Reusing the real draw functions means
// a preview can never drift from the actual visualizer.
//
// Rendering is done OFF the critical path: a shared, time-budgeted scheduler runs
// a few warm-up frames per animation frame so opening the tab stays responsive
// (each preview fills in progressively), and finished previews are cached so
// reopening the tab - or re-selecting - is instant.

const WARMUP = 48 // frames rendered to settle the image, then it holds

// A fixed, music-like spectrum. The bars average freq over LOG-spaced bin ranges,
// so the jaggedness has to live in log-frequency space or it averages away to a
// flat row. Bar height is mostly absolute (see makeBands), so this static
// spectrum reads as a lively, varied frame.
function synth(freq: Uint8Array, time: Uint8Array): void {
  const n = freq.length
  for (let i = 0; i < n; i++) {
    const lb = Math.log(i + 3) // ~1.1 (bass) .. ~6.9 (treble)
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

// Caps couples neighbours into a smooth envelope, so a jagged spectrum reads as
// noise; heavily blur it for that style only.
function blurCaps(freq: Uint8Array, buf: Float32Array): void {
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
      buf[i] = s / c
    }
    for (let i = 0; i < N; i++) freq[i] = buf[i]
  }
}

// These styles need the whole frame (radial rings, and the continuous liquid
// band); everything else is a left-to-right bar shape we render wide and crop.
const RADIAL = new Set(['ripples', 'outline-round', 'solid-round', 'liquid'])
const ZOOM = 2.6 // how much wider than the box a bar style is rendered before cropping

// ---- shared render scheduler: keeps the UI responsive ----
// Each job renders a slice of one preview and returns true when it's done. The
// pump runs jobs within an ~8ms budget per animation frame, then yields.
const jobs: Array<() => boolean> = []
let pumping = false
function pump(): void {
  const t0 = performance.now()
  while (jobs.length && performance.now() - t0 < 8) {
    if (jobs[0]()) jobs.shift()
  }
  pumping = jobs.length > 0
  if (pumping) requestAnimationFrame(pump)
}
function enqueue(job: () => boolean): () => void {
  jobs.push(job)
  if (!pumping) {
    pumping = true
    requestAnimationFrame(pump)
  }
  return () => {
    const i = jobs.indexOf(job)
    if (i >= 0) jobs.splice(i, 1)
  }
}

// Finished previews, keyed by style + theme + pixel size. Small set (12 styles ×
// a few preset themes × a size or two), so no eviction needed.
const cache = new Map<string, HTMLCanvasElement>()

export function VizPreview({ styleId, theme }: { styleId: string; theme: VizTheme }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let cancelled = false
    let dequeue: (() => void) | null = null

    const start = (): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      const W = Math.round(rect.width * dpr)
      const H = Math.round(rect.height * dpr)
      if (W <= 0 || H <= 0) return
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W
        canvas.height = H
      }

      const key = `${styleId}|${theme.id}|${W}x${H}`
      const hit = cache.get(key)
      if (hit) {
        ctx.clearRect(0, 0, W, H)
        ctx.drawImage(hit, 0, 0)
        return
      }

      const radial = RADIAL.has(styleId)
      // The ring packs ~150 rays, so supersample it harder: the rays downscale
      // thinner than their spacing, leaving gaps (a ring of spikes, not a disc).
      const ss = radial ? (styleId === 'ripples' ? 4 : 2) : 1
      const ampScale = styleId === 'ripples' ? 0.65 : 1
      const OW = radial ? W * ss : Math.round(W * ZOOM)
      const OH = H * ss
      const off = document.createElement('canvas')
      off.width = OW
      off.height = OH
      const octx = off.getContext('2d')
      if (!octx) return
      const style = styleById(styleId)
      const draw: DrawFn = style.create(OW, OH)
      const sx = Math.round((OW - W) / 2)

      // The spectrum is static, so build it ONCE (not per warm-up frame).
      const freq = new Uint8Array(1024)
      const time = new Uint8Array(2048).fill(128)
      synth(freq, time)
      if (ampScale !== 1) for (let i = 0; i < freq.length; i++) freq[i] = freq[i] * ampScale
      if (styleId === 'mirror-caps') blurCaps(freq, new Float32Array(freq.length))

      const frame: AudioFrame = {
        freq, time, bass: band(freq, 0, 40), mid: band(freq, 40, 300), treble: band(freq, 300, 700),
        level: 0.62, beat: 0, drop: 0, t: 0, playing: true, sampleRate: 44100
      }
      const opts: VizOpts = {
        accent: theme.accent, palette: theme.palette, vgrad: theme.vgrad ?? null,
        cycle: theme.cycle ?? null, dropStyle: 1, previewBurst: 0, sensitivity: 1, dpr
      }

      const renderFrame = (f: number): void => {
        frame.t = f * 16
        if (style.trails) {
          octx.fillStyle = 'rgba(13,15,20,0.25)'
          octx.fillRect(0, 0, OW, OH)
        } else {
          octx.clearRect(0, 0, OW, OH)
        }
        octx.save()
        if (theme.alpha != null) octx.globalAlpha = theme.alpha
        // No glow: it blooms rings into a ball and washes out bars. The picker
        // shows shape; colour/glow is chosen under Colours.
        try {
          draw(octx, OW, OH, frame, opts)
        } catch {
          /* a style that can't draw this frame just leaves the last one */
        }
        octx.restore()
      }
      const composite = (): void => {
        ctx.clearRect(0, 0, W, H)
        if (radial) {
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(off, 0, 0, OW, OH, 0, 0, W, H)
        } else {
          ctx.drawImage(off, sx, 0, W, H, 0, 0, W, H) // crop the centre 1:1
        }
      }

      let f = 0
      const CHUNK = radial ? 3 : 6 // frames per scheduler slice (rings are heavier)
      const step = (): boolean => {
        if (cancelled) return true
        const end = Math.min(WARMUP, f + CHUNK)
        for (; f <= end; f++) renderFrame(f)
        composite() // progressive: the preview fills in as it settles
        if (f > WARMUP) {
          const store = document.createElement('canvas')
          store.width = W
          store.height = H
          store.getContext('2d')?.drawImage(canvas, 0, 0)
          cache.set(key, store)
          return true
        }
        return false
      }
      dequeue = enqueue(step)
    }

    start()
    // Re-render (still static) if the box resizes.
    const ro = new ResizeObserver(() => {
      if (dequeue) {
        dequeue()
        dequeue = null
      }
      start()
    })
    ro.observe(canvas)
    return () => {
      cancelled = true
      if (dequeue) dequeue()
      ro.disconnect()
    }
  }, [styleId, theme])

  return <canvas ref={ref} className="h-full w-full" style={{ background: '#0d0f14' }} />
}
