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

/** Analyse a decoded track and return drop timestamps in seconds, sorted.
 *  `target` caps how many of the strongest drops to keep. */
export function analyzeDrops(buffer: AudioBuffer, target = 12): number[] {
  const sr = buffer.sampleRate
  const n = buffer.length
  if (n === 0) return []

  // Mix to mono.
  const ch = buffer.numberOfChannels
  const mono = new Float32Array(n)
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < n; i++) mono[i] += d[i] / ch
  }

  // Sub-bass: a cascaded one-pole low-pass (~120 Hz, 12 dB/oct) isolates the kick
  // and bassline energy, which is what a drop slams back in.
  const a = 1 - Math.exp((-2 * Math.PI * 120) / sr)
  let y1 = 0
  let y2 = 0
  const low = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    y1 += a * (mono[i] - y1)
    y2 += a * (y1 - y2)
    low[i] = y2
  }

  // Per-hop RMS envelopes (~60 fps) for overall loudness and sub-bass.
  const hop = Math.max(1, Math.floor(sr / 60))
  const frames = Math.floor(n / hop)
  const loud = new Float32Array(frames)
  const sub = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    const s = f * hop
    let sl = 0
    let ss = 0
    for (let i = 0; i < hop; i++) {
      const v = mono[s + i]
      sl += v * v
      const w = low[s + i]
      ss += w * w
    }
    loud[f] = Math.sqrt(sl / hop)
    sub[f] = Math.sqrt(ss / hop)
  }

  smooth(loud)
  smooth(sub)
  normalize(loud)
  normalize(sub)

  const fps = sr / hop
  const preWin = Math.floor(4 * fps) // build-up look-back
  const minSpace = Math.floor(5 * fps) // don't fire two drops closer than this
  // energy = whichever of sub-bass / overall loudness is higher; a drop can slam
  // either the low end or the whole mix back in.
  const cands: Array<{ t: number; score: number }> = []
  let wasLow = true
  let lastF = -1e9
  for (let f = 0; f < frames; f++) {
    const e = Math.max(sub[f], loud[f])
    if (e < 0.4) wasLow = true
    if (wasLow && e > 0.65 && f - lastF > minSpace) {
      let mn = 1
      for (let j = Math.max(0, f - preWin); j < f; j++) {
        const ej = Math.max(sub[j], loud[j])
        if (ej < mn) mn = ej
      }
      cands.push({ t: f / fps, score: e - mn })
      wasLow = false
      lastF = f
    }
  }

  cands.sort((p, q) => q.score - p.score)
  return cands
    .slice(0, target)
    .filter((c) => c.score > 0.2)
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
