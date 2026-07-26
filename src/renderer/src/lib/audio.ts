// One shared Web Audio context for the window, plus a helper to pull a downsampled
// amplitude envelope (peaks) from a media file for the waveform transport styles.

let ctx: AudioContext | null = null
export function getAudioContext(): AudioContext {
  ctx ??= new AudioContext()
  return ctx
}

/** Decode `url` and reduce it to `buckets` normalised peak amplitudes (0-1), for
 *  drawing a static waveform. Throws if the file can't be fetched/decoded. */
export async function loadPeaks(url: string, buckets = 160): Promise<number[]> {
  const resp = await fetch(url)
  const bytes = await resp.arrayBuffer()
  const audio = await getAudioContext().decodeAudioData(bytes)
  const data = audio.getChannelData(0)
  const per = Math.max(1, Math.floor(data.length / buckets))
  const peaks: number[] = []
  let max = 1e-6
  for (let b = 0; b < buckets; b++) {
    let m = 0
    const s = b * per
    for (let i = 0; i < per && s + i < data.length; i++) {
      const v = Math.abs(data[s + i])
      if (v > m) m = v
    }
    peaks.push(m)
    if (m > max) max = m
  }
  // Perceptual-ish lift so quiet passages still show, then normalise.
  return peaks.map((p) => Math.pow(p / max, 0.7))
}
