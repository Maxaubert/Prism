import { useEffect, useRef, type JSX } from 'react'
import { clamp, type AudioFrame, type DrawFn, type VizOpts, type VizTheme } from '../lib/viz/core'
import { styleById } from '../lib/viz/styles'

// Drives whichever visualizer style is selected. Owns the Web Audio graph and
// the per-frame analysis (bands, level, beat) so the styles only have to draw.
//
// A MediaElementSource can only ever be created once per element, so it is
// cached; the AudioContext is shared for the window.

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

const BG = '#0d0f14'

export function Visualizer({
  media,
  styleId,
  theme
}: {
  media: HTMLMediaElement | null
  styleId: string
  theme: VizTheme
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  // The draw loop reads the current style + theme through refs so switching
  // either does not tear down and restart the loop. Synced in effects, since
  // writing to a ref during render is not allowed.
  const styleRef = useRef(styleId)
  const themeRef = useRef(theme)
  useEffect(() => {
    styleRef.current = styleId
  }, [styleId])
  useEffect(() => {
    themeRef.current = theme
  }, [theme])

  // Wire the element into the graph, and keep the context resumed while it plays.
  useEffect(() => {
    if (!media) return
    const ctx = getAudioContext()
    let source: MediaElementAudioSourceNode
    try {
      source = getSource(ctx, media)
    } catch {
      return // not readable; leave the idle state
    }
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.6
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
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const freq = new Uint8Array(1024)
    // 128 is silence; a zero-filled buffer would read as full-scale deflection.
    const time = new Uint8Array(2048).fill(128)
    const frame: AudioFrame = {
      freq, time, bass: 0, mid: 0, treble: 0, level: 0, beat: 0, drop: 0,
      t: 0, playing: false, sampleRate: 44100
    }
    const opts: VizOpts = { accent: theme.accent, palette: theme.palette, sensitivity: 1, dpr: 1 }

    let raf = 0
    let bassAvg = 0
    let beat = 0
    // Drop detection (see below): tracks a break-then-slam, not every kick.
    let bassSlow = 0
    let bassMax = 0.2
    let breakFrames = 0
    let dropPending = false
    let drop = 0
    let framesPlaying = 0
    let draw: DrawFn | null = null
    let builtFor = ''
    let builtW = 0
    let builtH = 0

    const bandAvg = (from: number, to: number): number => {
      let s = 0
      let c = 0
      for (let i = from; i < to && i < freq.length; i++) {
        s += freq[i]
        c++
      }
      return c ? s / c / 255 : 0
    }

    const tick = (now: number): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      const W = Math.round(rect.width * dpr)
      const H = Math.round(rect.height * dpr)
      if (W > 0 && H > 0) {
        if (canvas.width !== W || canvas.height !== H) {
          canvas.width = W
          canvas.height = H
        }
        const style = styleById(styleRef.current)
        if (builtFor !== style.id || builtW !== W || builtH !== H) {
          draw = style.create(W, H)
          builtFor = style.id
          builtW = W
          builtH = H
          ctx.clearRect(0, 0, W, H)
        }

        const an = analyserRef.current
        if (an) {
          an.getByteFrequencyData(freq)
          an.getByteTimeDomainData(time)
        }
        const sr = audioCtx ? audioCtx.sampleRate : 44100
        const binHz = sr / 2048
        const bin = (hz: number): number => Math.max(1, Math.round(hz / binHz))
        frame.sampleRate = sr
        frame.t = now
        frame.playing = !!media && !media.paused
        frame.bass = bandAvg(bin(20), bin(160))
        frame.mid = bandAvg(bin(160), bin(2000))
        frame.treble = bandAvg(bin(2000), bin(11000))

        let sum = 0
        for (let i = 0; i < time.length; i += 2) {
          const v = (time[i] - 128) / 128
          sum += v * v
        }
        frame.level = clamp(Math.sqrt(sum / (time.length / 2)) * 1.6, 0, 1)

        // Transient detector: instantaneous bass against its slow mean.
        bassAvg = bassAvg * 0.96 + frame.bass * 0.04
        beat = Math.max(beat * 0.9, clamp((frame.bass - bassAvg * 1.22) * 3.4, 0, 1))
        frame.beat = beat

        // Drop detector: a proper drop is the mix breaking down (bass falls away
        // for a sustained beat or two) then slamming back to full - not every
        // kick. We smooth the bass, track its recent loud level, and fire once
        // when it climbs back to full after a real break. Thresholds are relative
        // to the loud level so it works whatever the track's absolute loudness.
        // Resetting on pause means hitting play never reads the silence-to-music
        // jump as a drop.
        if (!frame.playing) {
          breakFrames = 0
          dropPending = false
          framesPlaying = 0
        } else {
          framesPlaying++
          bassSlow += (frame.bass - bassSlow) * 0.25
          bassMax = Math.max(bassSlow, bassMax * 0.9995)
          if (bassSlow < bassMax * 0.68) {
            breakFrames++
          } else {
            // Climbed out of a lull. A sustained break (not the brief dip of the
            // play-start ramp) arms a drop for when the bass reaches full again.
            if (breakFrames > 25 && framesPlaying > 40) dropPending = true
            breakFrames = 0
          }
          if (dropPending && bassSlow > bassMax * 0.9) {
            drop = 1
            dropPending = false
          }
        }
        drop *= 0.9
        frame.drop = drop

        // The theme drives colour: palette + accent every style reads, plus an
        // optional global glow / opacity applied here so it works on any shape.
        const th = themeRef.current
        opts.palette = th.palette
        opts.accent = th.accent
        opts.vgrad = th.vgrad ?? null
        opts.cycle = th.cycle ?? null
        opts.dpr = dpr

        const style2 = styleById(styleRef.current)
        if (style2.trails) {
          ctx.fillStyle = 'rgba(13,15,20,0.22)'
          ctx.fillRect(0, 0, W, H)
        } else {
          ctx.clearRect(0, 0, W, H)
        }
        if (draw) {
          ctx.save()
          if (th.alpha != null) ctx.globalAlpha = th.alpha
          if (th.glow) {
            ctx.shadowColor = th.accent
            ctx.shadowBlur = th.glow * dpr
          }
          try {
            draw(ctx, W, H, frame, opts)
          } catch (err) {
            console.error('[viz]', builtFor, err)
            draw = null
          }
          ctx.restore()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [media, theme.accent, theme.palette])

  return <canvas ref={canvasRef} className="h-full w-full" style={{ background: BG }} />
}
