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
  const minSpace = Math.floor(7 * fps) // don't fire two drops closer than this
  const postN = Math.floor(2 * fps) // sustain look-ahead

  // Two kinds of drop onset feed the candidate list:
  //  E: combined energy (sub-bass or loudness) is pulled low then slams back.
  //  B: sub-bass specifically cuts out then reappears - a classic drop even when
  //     the mids/highs never dropped, which E alone would miss (it keys on the
  //     max of the two). Bass out-then-back is one of the strongest drop signals.
  const raw: number[] = []
  let eLow = true
  for (let f = 0; f < frames; f++) {
    const e = Math.max(sub[f], loud[f])
    if (e < 0.4) eLow = true
    if (eLow && e > 0.65) {
      eLow = false
      raw.push(f)
    }
  }
  let subLow = true
  for (let f = 0; f < frames; f++) {
    if (sub[f] < 0.35) subLow = true
    if (subLow && sub[f] > 0.7) {
      subLow = false
      raw.push(f)
    }
  }
  raw.sort((a, b) => a - b)

  const cands: Array<{ t: number; score: number }> = []
  let lastF = -1e9
  let prev = -1
  for (const f of raw) {
    if (f === prev) continue // same frame from both sources
    prev = f
    if (f - lastF < minSpace) continue
    // Sustain: a real drop holds a loud section after the slam; a fill or one-off
    // hit spikes then falls straight back. The main precision filter - a
    // look-ahead only possible because we analyse offline.
    const pn = Math.min(frames, f + postN)
    let post = 0
    for (let j = f; j < pn; j++) post += Math.max(sub[j], loud[j])
    post /= Math.max(1, pn - f)
    if (post < 0.68) continue
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
