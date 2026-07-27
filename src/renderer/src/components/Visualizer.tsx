import { useEffect, useRef, type JSX } from 'react'
import { clamp, type AudioFrame, type DrawFn, type VizOpts, type VizTheme } from '../lib/viz/core'
import { styleById } from '../lib/viz/styles'
import { analyzeDrops } from '../lib/viz/drops'
import { getAudioContext } from '../lib/audio'

// Drives whichever visualizer style is selected. Owns the Web Audio graph and
// the per-frame analysis (bands, level, beat) so the styles only have to draw.
//
// A MediaElementSource can only ever be created once per element, so it is
// cached; the AudioContext is shared for the window.

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
  dropStyle,
  previewBurst,
  glow,
  cycle,
  move
}: {
  media: HTMLMediaElement | null
  styleId: string
  theme: VizTheme
  dropStyle: number
  previewBurst: number
  glow: boolean
  cycle: boolean
  move: boolean
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  // Drop timestamps (seconds) from the offline analysis of the current file.
  const dropTimesRef = useRef<number[]>([])
  // Colour effect toggles, read live by the draw loop.
  const fxRef = useRef({ glow, cycle, move })
  useEffect(() => {
    fxRef.current = { glow, cycle, move }
  }, [glow, cycle, move])
  // The draw loop reads the current style + theme + drop variant through refs so
  // switching any of them does not tear down and restart the loop. Synced in
  // effects, since writing to a ref during render is not allowed.
  const styleRef = useRef(styleId)
  const themeRef = useRef(theme)
  const dropStyleRef = useRef(dropStyle)
  const previewRef = useRef(previewBurst)
  useEffect(() => {
    styleRef.current = styleId
  }, [styleId])
  useEffect(() => {
    themeRef.current = theme
  }, [theme])
  useEffect(() => {
    dropStyleRef.current = dropStyle
  }, [dropStyle])
  useEffect(() => {
    previewRef.current = previewBurst
  }, [previewBurst])

  // Analyse the file for drops in the background while it plays. Decoding +
  // analysis take a second or two; until then dropTimes is empty and no drop
  // rings fire, which is fine (a drop in the first couple seconds is just the
  // track starting). Re-runs whenever the element loads new media.
  useEffect(() => {
    if (!media) return
    let cancelled = false
    const run = (): void => {
      dropTimesRef.current = []
      const url = media.currentSrc || media.src
      if (!url) return
      void (async () => {
        try {
          const resp = await fetch(url)
          const bytes = await resp.arrayBuffer()
          const audio = await getAudioContext().decodeAudioData(bytes)
          if (!cancelled) dropTimesRef.current = analyzeDrops(audio)
        } catch {
          /* leave empty - no drop rings for this file */
        }
      })()
    }
    run()
    media.addEventListener('loadeddata', run)
    return () => {
      cancelled = true
      media.removeEventListener('loadeddata', run)
    }
  }, [media])

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
    // Drops come from the offline analysis (dropTimesRef): we fire when playback
    // crosses a pre-computed drop timestamp, then let the pulse decay.
    let drop = 0
    let lastTime = 0
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
        const sr = getAudioContext().sampleRate
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

        // A light bass-transient (kept for any style that wants a beat pulse).
        if (frame.playing) {
          bassAvg = bassAvg * 0.96 + frame.bass * 0.04
          beat = Math.max(beat * 0.9, clamp((frame.bass - bassAvg * 1.22) * 3.4, 0, 1))
        } else {
          beat = 0
        }

        // Drops: fire when normal forward playback crosses a pre-computed drop
        // timestamp. The small-advance guard means a seek (a big jump in
        // currentTime) doesn't fire every drop it skips over.
        const ct = media ? media.currentTime : 0
        if (frame.playing && ct > lastTime && ct - lastTime < 1) {
          const dts = dropTimesRef.current
          for (let i = 0; i < dts.length; i++) {
            if (dts[i] > lastTime && dts[i] <= ct) {
              drop = 1
              break
            }
          }
        }
        lastTime = ct
        drop *= 0.9
        frame.beat = beat
        frame.drop = drop

        // The theme drives colour: palette + accent every style reads, plus an
        // optional global glow / opacity applied here so it works on any shape.
        const th = themeRef.current
        opts.palette = th.palette
        opts.accent = th.accent
        opts.vgrad = th.vgrad ?? null
        opts.cycle = fxRef.current.cycle
        opts.move = fxRef.current.move
        opts.dropStyle = dropStyleRef.current
        opts.previewBurst = previewRef.current
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
          if (fxRef.current.glow) {
            ctx.shadowColor = th.accent
            ctx.shadowBlur = 12 * dpr
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
