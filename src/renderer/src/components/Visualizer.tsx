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
  theme,
  dropStyle
}: {
  media: HTMLMediaElement | null
  styleId: string
  theme: VizTheme
  dropStyle: number
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  // The draw loop reads the current style + theme + drop variant through refs so
  // switching any of them does not tear down and restart the loop. Synced in
  // effects, since writing to a ref during render is not allowed.
  const styleRef = useRef(styleId)
  const themeRef = useRef(theme)
  const dropStyleRef = useRef(dropStyle)
  useEffect(() => {
    styleRef.current = styleId
  }, [styleId])
  useEffect(() => {
    themeRef.current = theme
  }, [theme])
  useEffect(() => {
    dropStyleRef.current = dropStyle
  }, [dropStyle])

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
    let loud = 0.85 // frozen-during-break estimate of the loud-section bass level
    let breakFrames = 0
    let dropPending = false
    let dropConfirm = false
    let confirmPeak = 0
    let confirmWait = 0
    let fireIn = 0 // countdown: land the shockwave on the slam, not a hair ahead
    let drop = 0
    let framesPlaying = 0
    let wasPlaying = false
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

        // Pausing zeroes the analyser, so on resume the bass jumps from silence
        // and any detector that compares against a stale average reads a false
        // hit. On the transition into playing we prime the running means to the
        // current level and open a short settle window; while paused both pulses
        // are forced to zero so nothing fires.
        if (frame.playing && !wasPlaying) {
          bassAvg = frame.bass
          bassSlow = frame.bass
          framesPlaying = 0
          breakFrames = 0
          dropPending = false
          dropConfirm = false
          fireIn = 0
        }
        wasPlaying = frame.playing
        const settling = framesPlaying < 15

        if (!frame.playing) {
          beat = 0
          drop = 0
          breakFrames = 0
          dropPending = false
          dropConfirm = false
          fireIn = 0
          framesPlaying = 0
        } else {
          framesPlaying++
          // Transient detector: instantaneous bass against its slow mean. During
          // the settle window we pin the mean to the current bass so the ramp-in
          // can't spike a kick.
          bassAvg = bassAvg * 0.96 + frame.bass * 0.04
          if (settling) {
            bassAvg = frame.bass
            beat = 0
          } else {
            beat = Math.max(beat * 0.9, clamp((frame.bass - bassAvg * 1.22) * 3.4, 0, 1))
          }

          // Drop detector: a proper drop is the mix breaking down (bass falls away
          // for a sustained beat or two) then slamming back to full - not every
          // kick, and not a quiet-section swell.
          //
          // `loud` tracks the loud-section bass level: it rises fast, decays
          // slowly, and is frozen while a break is in progress or armed, so the
          // recovery threshold reflects the level the mix had *before* it broke.
          // A drop fires when the bass climbs back to that full level (the impact)
          // - not partway up the build-in, where an earlier plateau would trip an
          // absolute threshold a beat too early. Everything is relative to `loud`,
          // so it adapts to any track's loudness and a quiet intro (which never
          // reaches its own recovery threshold) can't misfire.
          bassSlow += (frame.bass - bassSlow) * 0.25
          if (bassSlow > loud) loud += (bassSlow - loud) * 0.08
          else if (breakFrames === 0 && !dropPending && !dropConfirm) loud += (bassSlow - loud) * 0.003
          if (bassSlow < loud * 0.6) {
            breakFrames++
          } else {
            if (breakFrames > 25 && framesPlaying > 40) dropPending = true
            breakFrames = 0
          }
          // The recovery isn't instant: the bass climbs to an intermediate plateau,
          // holds a beat, then makes a final jump to the top. Firing when it first
          // crosses the full level lands a beat early, on the climb. So once it
          // reaches full, track the recovery to its peak and fire when it stops
          // rising - the actual impact. A sharp slam peaks at once and fires
          // immediately; the wait cap keeps it from hanging if it never turns down.
          if (dropPending && bassSlow > loud * 0.92) {
            dropPending = false
            dropConfirm = true
            confirmPeak = bassSlow
            confirmWait = 0
          }
          if (dropConfirm) {
            confirmWait++
            if (bassSlow > confirmPeak) confirmPeak = bassSlow
            else if (bassSlow < confirmPeak - 0.008 || confirmWait > 40) {
              // Detected the recovery peak. The smoothed bass peaks ~0.3s before
              // the audible slam lands, so hold the shockwave that long to sit it
              // on the drop rather than a hair ahead. Tune the frame count here.
              fireIn = 20
              dropConfirm = false
            }
          }
          if (fireIn > 0) {
            fireIn--
            if (fireIn === 0) drop = 1
          }
        }
        drop *= 0.9
        frame.beat = beat
        frame.drop = drop

        // The theme drives colour: palette + accent every style reads, plus an
        // optional global glow / opacity applied here so it works on any shape.
        const th = themeRef.current
        opts.palette = th.palette
        opts.accent = th.accent
        opts.vgrad = th.vgrad ?? null
        opts.cycle = th.cycle ?? null
        opts.dropStyle = dropStyleRef.current
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
