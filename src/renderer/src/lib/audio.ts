// One shared Web Audio context for the window, plus a helper to pull a downsampled
// amplitude envelope (peaks) from a media file for the waveform transport styles.

let ctx: AudioContext | null = null
export function getAudioContext(): AudioContext {
  ctx ??= new AudioContext()
  return ctx
}

/**
 * Let the context sleep when nothing is playing through it (2026-08-28).
 *
 * A running AudioContext keeps an audio thread and a device clock alive; ours
 * was only ever resumed, so one boosted film left it running for the rest of
 * the session. Suspending is safe because every path back in - applyVolume,
 * the visualizer's tap, a play event - resumes it first.
 */
export function idleAudioContext(): void {
  if (ctx && ctx.state === 'running') void ctx.suspend()
}

export function wakeAudioContext(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume()
}

// loadPeaks lived here and pulled the WHOLE file into the page to decode it -
// 7.4GB of renderer memory on a 2GB film, for 160 numbers. The envelope now
// comes from ffmpeg in main, streamed: see src/main/peaks.ts and useWaveform.

/**
 * Volume past 100% (2026-08-27), the way VLC does it.
 *
 * `HTMLMediaElement.volume` is capped at 1 by the spec, so anything louder has
 * to go through Web Audio: source -> gain -> destination, with the gain doing
 * the boosting. The chain is built ONCE per element (a second
 * MediaElementSource for the same element throws) and only when a boost is
 * actually asked for, so an ordinary file at 80% never touches Web Audio at
 * all.
 *
 * The visualizer taps the same chain rather than building its own, for the
 * same reason.
 */
const graphs = new WeakMap<HTMLMediaElement, { source: MediaElementAudioSourceNode; gain: GainNode }>()

/**
 * Is this element safe to route? A media resource fetched WITHOUT CORS taints
 * its MediaElementSource: the graph gets digital silence, and the element can
 * never be un-routed, so the sound does not come back when the volume drops
 * again. Measured 2026-08-27: peak 0 without `crossOrigin`, 0.129 with it.
 * Refusing to route is a volume that stops at 100%, which is a far better
 * failure than a film that has gone quiet.
 */
export function routable(el: HTMLMediaElement): boolean {
  return el.crossOrigin === 'anonymous' || el.crossOrigin === 'use-credentials'
}

export function mediaGraph(
  el: HTMLMediaElement
): { source: MediaElementAudioSourceNode; gain: GainNode } | null {
  const existing = graphs.get(el)
  if (existing) return existing
  if (!routable(el)) return null
  try {
    const ctx = getAudioContext()
    const source = ctx.createMediaElementSource(el)
    const gain = ctx.createGain()
    source.connect(gain)
    gain.connect(ctx.destination)
    const made = { source, gain }
    graphs.set(el, made)
    return made
  } catch {
    return null // already sourced elsewhere, or not readable
  }
}

/** What the ELEMENT's own volume should be for a 0-2 setting: it stops at 1. */
export function elementVolume(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** What the GAIN should be for the same setting: 1 until the element runs out. */
export function boostFactor(v: number): number {
  return v > 1 ? v : 1
}

/**
 * Apply a 0-2 volume to an element. Below 100% this is the element's own
 * volume and nothing else; above it, the gain takes over.
 */
export function applyVolume(el: HTMLMediaElement, v: number, muted: boolean): void {
  el.volume = elementVolume(v)
  el.muted = muted
  const factor = boostFactor(v)
  // Never build the chain just to set a gain of 1: a file played at or below
  // 100% should sound exactly as it did before any of this existed.
  if (factor === 1 && !graphs.has(el)) return
  const g = mediaGraph(el)
  if (!g) return
  g.gain.gain.value = muted ? 0 : factor
  const ctx = getAudioContext()
  // Routed audio is silent while the context is suspended, which is the state
  // it starts in until a gesture.
  if (ctx.state === 'suspended') void ctx.resume()
}
