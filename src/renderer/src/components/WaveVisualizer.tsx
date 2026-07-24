import { useEffect, useRef, type JSX } from 'react'

// A horizontal wave-bar visualizer: a row of bars mirrored above and below a
// center line, each spiking to the live energy of a frequency band — the classic
// "audio wave graph on a horizontal line". At silence it settles to a calm line.
//
// One of the interchangeable visualizer styles in the ROADMAP customization plan;
// this is the default. Runs off a shared AudioContext + AnalyserNode (a
// MediaElementSource can only be created once per element, so it is cached).

let audioCtx: AudioContext | null = null
function getAudioContext(): AudioContext {
  audioCtx ??= new AudioContext()
  return audioCtx
}
const sourceCache = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
function getSource(ctx: AudioContext, el: HTMLMediaElement): MediaElementAudioSourceNode {
  let s = sourceCache.get(el)
  if (!s) {
    s = ctx.createMediaElementSource(el)
    sourceCache.set(el, s)
  }
  return s
}

const BARS = 96 // bars across the width
const CONTRAST = 2.2 // >1 widens the gap between loud and quiet bars
const TILT = 1.7 // lift quieter high frequencies so the whole width moves
const LEVEL = 1.35 // overall height
const REACTION = 0.32 // temporal smoothing: how fast bars chase the target
const MIN_BAR = 0.02 // idle half-height (fraction) so silence shows a gentle line
const MAX_HALF = 0.44 // max half-height as a fraction of canvas height

// Brand sweep across the width: indigo -> violet -> coral.
function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}
function paletteAt(t: number): string {
  const stops = [
    [91, 91, 214], // #5b5bd6 indigo
    [154, 108, 255], // #9a6cff violet
    [255, 154, 139] // #ff9a8b coral
  ]
  const seg = t < 0.5 ? 0 : 1
  const lt = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5
  const [ar, ag, ab] = stops[seg]
  const [br, bg, bb] = stops[seg + 1]
  return `rgb(${lerp(ar, br, lt)},${lerp(ag, bg, lt)},${lerp(ab, bb, lt)})`
}

export function WaveVisualizer({ media }: { media: HTMLMediaElement | null }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)

  // Wire the element into the graph and keep the context resumed while it plays.
  useEffect(() => {
    if (!media) return
    const ctx = getAudioContext()
    let source: MediaElementAudioSourceNode
    try {
      source = getSource(ctx, media)
    } catch {
      return // element not readable; leave the idle line
    }
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.72
    source.connect(analyser)
    analyser.connect(ctx.destination)
    analyserRef.current = analyser
    const resume = (): void => {
      if (ctx.state === 'suspended') void ctx.resume()
    }
    media.addEventListener('play', resume)
    window.addEventListener('pointerdown', resume)
    if (!media.paused) resume()
    return () => {
      media.removeEventListener('play', resume)
      window.removeEventListener('pointerdown', resume)
      try {
        source.disconnect()
      } catch {
        /* already disconnected */
      }
      analyser.disconnect()
      analyserRef.current = null
    }
  }, [media])

  // Draw loop.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    const freq = new Uint8Array(1024)
    const vals = new Float32Array(BARS)
    let raf = 0

    const fit = (): void => {
      const r = canvas.getBoundingClientRect()
      const w = Math.round(r.width * DPR)
      const h = Math.round(r.height * DPR)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }

    const draw = (): void => {
      fit()
      const W = canvas.width
      const H = canvas.height
      g.clearRect(0, 0, W, H)
      const mid = H / 2

      const an = analyserRef.current
      const live = an != null && audioCtx?.state === 'running'
      if (live) an.getByteFrequencyData(freq)

      const slot = W / BARS
      const bw = Math.max(2 * DPR, slot * 0.62)
      const radius = bw / 2

      // faint baseline the bars grow from
      g.fillStyle = 'rgba(255,255,255,0.06)'
      g.fillRect(0, mid - DPR / 2, W, DPR)

      for (let i = 0; i < BARS; i++) {
        const frac = i / (BARS - 1)
        // log-ish bin spread: more bars where the musical energy lives
        const bin = 2 + Math.floor(Math.pow(frac, 1.6) * 380)
        const raw = live ? freq[Math.min(freq.length - 1, bin)] / 255 : 0
        const shaped = Math.pow(raw, CONTRAST) * (1 + frac * TILT)
        const target = shaped * LEVEL
        vals[i] += (target - vals[i]) * REACTION
        const half = Math.max(MIN_BAR, vals[i]) * (H * MAX_HALF)

        const x = i * slot + (slot - bw) / 2
        g.fillStyle = paletteAt(frac)
        g.beginPath()
        g.roundRect(x, mid - half, bw, half * 2, radius)
        g.fill()
      }

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} className="h-full w-full" />
}
