import { useEffect, useRef, type JSX } from 'react'
import { clamp, type AudioFrame, type DrawFn, type VizOpts, type VizTheme } from '../lib/viz/core'
import { styleById } from '../lib/viz/styles'
import { analyzeDrops } from '../lib/viz/drops'
import { getAudioContext, mediaGraph } from '../lib/audio'

// Drives whichever visualizer style is selected. Owns the Web Audio graph and
// the per-frame analysis (bands, level, beat) so the styles only have to draw.
//
// A MediaElementSource can only ever be created once per element, so it is
// cached; the AudioContext is shared for the window.

// The visualizer paints on the window, not on a slab of its own: the canvas is
// transparent so a style's background (and its acrylic) shows through. Two
// things still need a colour, and both come from the app's own background:
// trails fade towards it, and the panel styles sit a shade off it.
function appBackground(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--p-bg').trim()
  return /^#|^rgb/.test(v) ? v : '#0d0f14'
}

function rgbOf(colour: string): [number, number, number] {
  if (colour.startsWith('#')) {
    const s = colour.slice(1)
    const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const m = colour.match(/[\d.]+/g)
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [13, 15, 20]
}

/** Past this, the drop analysis is skipped: its cost is the file's whole
 *  decoded length in memory, and nobody needs drop rings in an audiobook. */
const DROPS_MAX_SECONDS = 15 * 60

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
  //
  // Only for TRACKS (2026-08-26). This decodes the whole file to PCM, which
  // costs a multiple of its size in memory - fine for a song, ruinous for an
  // audiobook or a DJ set, and pointless either way: drop rings are a thing
  // that happens in music, not in a four-hour recording.
  useEffect(() => {
    if (!media) return
    let cancelled = false
    const run = (): void => {
      dropTimesRef.current = []
      if (Number.isFinite(media.duration) && media.duration > DROPS_MAX_SECONDS) return
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
    // ONE chain per element, owned by lib/audio: source -> gain -> destination.
    // The gain is what carries volume past 100%, and the analyser taps it
    // rather than making a second source (a second one throws) or a second
    // path to the speakers (that would play the file twice).
    const graph = mediaGraph(media)
    if (!graph) return // already sourced elsewhere, or not readable
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.6
    graph.gain.connect(analyser)
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
        // Only the tap comes down: the chain to the speakers belongs to the
        // element, not to the visualizer.
        graph.gain.disconnect(analyser)
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

    /**
     * A paused track draws nothing (2026-08-28).
     *
     * The loop used to run at the display's full refresh whatever the media
     * was doing, so a paused song held a 4K canvas redrawing 120 times a
     * second over an analyser reading silence. It still has to draw a FEW
     * frames after the pause - the styles decay rather than stop dead - so
     * the rule is: while paused, keep drawing until the picture has settled,
     * then idle until something plays again.
     */
    let stillFrames = 0
    let idleW = 0
    let idleH = 0
    const SETTLE_FRAMES = 45

    const tick = (now: number): void => {
      const idle = !!media && media.paused
      if (idle && stillFrames > SETTLE_FRAMES) {
        // Idle is not blind: a window resize or a style change still has to
        // redraw, or the canvas keeps the old size and the old style until
        // something plays again (2026-08-28).
        const r = canvas.getBoundingClientRect()
        const changed =
          Math.round(r.width) !== idleW ||
          Math.round(r.height) !== idleH ||
          styleRef.current !== builtFor
        if (!changed) {
          raf = requestAnimationFrame(tick)
          return
        }
        idleW = Math.round(r.width)
        idleH = Math.round(r.height)
        stillFrames = 0
      }
      stillFrames = idle ? stillFrames + 1 : 0
      const rect = canvas.getBoundingClientRect()
      // The display's real ratio, not a flat 2. A 225% screen was drawing a
      // 2360x611 buffer and letting the compositor stretch it to 2655x689, which
      // softened every edge in the visualizer. Capped at 3 so a 400% display
      // cannot ask for sixteen times the pixels.
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
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
        const bg = appBackground()
        if (style2.trails) {
          // Fade towards the window's own colour rather than a fixed dark.
          const [r, g, b] = rgbOf(bg)
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.22)`
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
    // The palette's CONTENTS, not the array: a caller that builds a new array
    // each render would otherwise restart the loop on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, theme.accent, theme.palette.join(',')])

  return <canvas ref={canvasRef} className="h-full w-full" />
}
