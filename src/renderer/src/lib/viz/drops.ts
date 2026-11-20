// Offline drop detection.
//
// Real-time, frame-by-frame drop detection can't work: it can't see the build-up
// leading into a drop, can't normalise against the whole track, and the live
// analyser value saturates. So instead we analyse the decoded file once (in the
// background, while it plays) and pre-compute the drop timestamps.
//
// The recipe follows the EDM drop literature: a drop is a *build-up then slam* -
// producers sweep the bass/low-mids out to build tension, then slam the full low
// end back for impact. So a drop is where energy (sub-bass or overall loudness)
// was suppressed for a stretch and then jumps back up. We score each such
// transition by how deep the build was and how hard it slams, rank them, and keep
// the strongest few, globally normalised.

/** What the analysis reads of a decoded track: an AudioBuffer fits. */
export interface PcmSource {
  sampleRate: number
  length: number
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

/** Frames of envelope per slice before the async analysis lets the UI breathe. */
const SLICE_FRAMES = 1500

interface Envelopes {
  loud: Float32Array
  sub: Float32Array
  hop: number
  frames: number
  fps: number
  /** Fills frames [f0, f1): mixes to mono, low-passes and takes the RMS in ONE pass over
   *  the samples, so no whole-track mono or low-pass array is ever held (audit #61). */
  fill(f0: number, f1: number): void
}

function envelopes(buffer: PcmSource): Envelopes {
  const sr = buffer.sampleRate
  const ch = buffer.numberOfChannels
  const data: Float32Array[] = []
  for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c))
  // Per-hop RMS envelopes (~60 fps) for overall loudness and sub-bass.
  const hop = Math.max(1, Math.floor(sr / 60))
  const frames = Math.floor(buffer.length / hop)
  const loud = new Float32Array(frames)
  const sub = new Float32Array(frames)
  // Sub-bass: a cascaded one-pole low-pass (~120 Hz, 12 dB/oct) isolates the kick
  // and bassline energy, which is what a drop slams back in.
  const a = 1 - Math.exp((-2 * Math.PI * 120) / sr)
  let y1 = 0
  let y2 = 0
  const fill = (f0: number, f1: number): void => {
    for (let f = f0; f < f1; f++) {
      const s = f * hop
      let sl = 0
      let ss = 0
      for (let i = 0; i < hop; i++) {
        let v = 0
        for (let c = 0; c < ch; c++) v += data[c][s + i] / ch
        y1 += a * (v - y1)
        y2 += a * (y1 - y2)
        sl += v * v
        ss += y2 * y2
      }
      loud[f] = Math.sqrt(sl / hop)
      sub[f] = Math.sqrt(ss / hop)
    }
  }
  return { loud, sub, hop, frames, fps: sr / hop, fill }
}

/** Analyse a decoded track and return drop timestamps in seconds, sorted.
 *  `target` caps how many of the strongest drops to keep. */
export function analyzeDrops(buffer: PcmSource, target = 12): number[] {
  if (buffer.length === 0) return []
  const env = envelopes(buffer)
  env.fill(0, env.frames)
  return pickDrops(env, target)
}

/** The same answer, computed in slices with a pause between them, so a long track does
 *  not freeze the window (audit #61). `signal` stops it early with no drops. */
export async function analyzeDropsAsync(
  buffer: PcmSource,
  target = 12,
  signal?: AbortSignal,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0))
): Promise<number[]> {
  if (buffer.length === 0) return []
  const env = envelopes(buffer)
  for (let f = 0; f < env.frames; f += SLICE_FRAMES) {
    if (signal?.aborted) return []
    env.fill(f, Math.min(env.frames, f + SLICE_FRAMES))
    await pause()
  }
  return pickDrops(env, target)
}

function pickDrops(env: Envelopes, target: number): number[] {
  const { loud, sub, frames, fps } = env
  smooth(loud)
  smooth(sub)
  normalize(loud)
  normalize(sub)

  const preWin = Math.floor(4 * fps) // build-up look-back
  const minSpace = Math.floor(7 * fps) // don't fire two drops closer than this
  const postN = Math.floor(2 * fps) // sustain look-ahead

  // Two kinds of drop onset feed the candidate list:
  //  E: combined energy (sub-bass or loudness) is pulled low then slams back.
  //  B: sub-bass DEEPLY and sustainedly cuts out (bass truly gone, not just the
  //     dip between two kicks) then reappears - one of the strongest drop cues,
  //     and it catches drops where the mids/highs never dropped (which E misses,
  //     since E keys on the max of the two).
  const raw: Array<{ f: number; src: 'E' | 'B' }> = []
  let eLow = true
  for (let f = 0; f < frames; f++) {
    const e = Math.max(sub[f], loud[f])
    if (e < 0.4) eLow = true
    if (eLow && e > 0.65) {
      eLow = false
      raw.push({ f, src: 'E' })
    }
  }
  let deep = false
  let cut = 0
  for (let f = 0; f < frames; f++) {
    if (sub[f] < 0.2) {
      cut++
      if (cut > 12) deep = true // ~0.2s of real silence in the low end
    } else {
      cut = 0
    }
    if (deep && sub[f] > 0.7) {
      deep = false
      raw.push({ f, src: 'B' })
    }
  }
  raw.sort((p, q) => p.f - q.f)

  const cands: Array<{ t: number; score: number }> = []
  let lastF = -1e9
  let prevF = -1
  for (const { f, src } of raw) {
    if (f === prevF) continue // same frame from both sources
    prevF = f
    if (f - lastF < minSpace) continue
    // Sustain: a real drop holds a loud section after the slam; a fill or one-off
    // hit spikes then falls straight back. The main precision filter (a look-ahead
    // only possible offline). A deep bass cut-out is already high-confidence, so it
    // passes a looser bar; the general energy detector must sustain harder.
    const pn = Math.min(frames, f + postN)
    let post = 0
    for (let j = f; j < pn; j++) post += Math.max(sub[j], loud[j])
    post /= Math.max(1, pn - f)
    if (post < (src === 'B' ? 0.6 : 0.68)) continue
    // Build depth on whichever dipped more - combined energy or sub-bass - so a
    // bass cut-out is scored on the bass drop, not the (unchanged) overall level.
    let minE = 1
    let minSub = 1
    for (let j = Math.max(0, f - preWin); j < f; j++) {
      const ej = Math.max(sub[j], loud[j])
      if (ej < minE) minE = ej
      if (sub[j] < minSub) minSub = sub[j]
    }
    const depth = Math.max(Math.max(sub[f], loud[f]) - minE, sub[f] - minSub)
    cands.push({ t: f / fps, score: depth * post })
    lastF = f
  }

  cands.sort((p, q) => q.score - p.score)
  return cands
    .slice(0, target)
    .filter((c) => c.score > 0.15)
    .map((c) => c.t)
    .sort((p, q) => p - q)
}

function smooth(x: Float32Array, alpha = 0.1): void {
  let s = 0
  for (let i = 0; i < x.length; i++) {
    s += (x[i] - s) * alpha
    x[i] = s
  }
}

function normalize(x: Float32Array): void {
  let mx = 1e-9
  for (let i = 0; i < x.length; i++) if (x[i] > mx) mx = x[i]
  for (let i = 0; i < x.length; i++) x[i] /= mx
}
