/**
 * The arithmetic between the microphone and whisper-server (#13): samples to a
 * WAV file, the window of a long clip, the rate Whisper wants, a level for the
 * meter. Pure on purpose. The capture itself (getUserMedia, the worklet) cannot
 * run under a unit test, so everything that CAN be wrong about the bytes lives
 * here, where it can be checked field by field.
 *
 * The WAV is built in memory and handed to main over IPC. Nothing here, or
 * anywhere downstream, writes audio to disk (the spec's rule).
 */

const HEADER_BYTES = 44
/** PCM16: what whisper-server reads without converting, and half the IPC
 *  payload of float32 (a 28 s window is 0.9 MB instead of 1.8). */
const BYTES_PER_SAMPLE = 2

/**
 * A complete mono PCM16 little-endian WAV file: the canonical 44-byte RIFF
 * header, then the samples. Anything outside [-1, 1] is CLAMPED: a hot
 * microphone that wraps round instead turns a loud syllable into a full-scale
 * click, which Whisper hears as a word. NaN is written as silence.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * BYTES_PER_SAMPLE
  const out = new Uint8Array(HEADER_BYTES + dataBytes)
  const view = new DataView(out.buffer)
  const tag = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) out[at + i] = text.charCodeAt(i)
  }

  tag(0, 'RIFF')
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true) // the file, less 'RIFF' and this field
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  view.setUint32(16, 16, true) // the fmt chunk's own size
  view.setUint16(20, 1, true) // format 1: integer PCM
  view.setUint16(22, 1, true) // channels
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true) // bytes a second
  view.setUint16(32, BYTES_PER_SAMPLE, true) // block align: one frame of one channel
  view.setUint16(34, 16, true) // bits a sample
  tag(36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < samples.length; i += 1) {
    // Scaled by 32768 so -1 is the bottom rail exactly, then clamped, since
    // +1 would otherwise be 32768, one past the top of an int16.
    const scaled = Math.round(samples[i] * 0x8000)
    const pcm = scaled > 0x7fff ? 0x7fff : scaled < -0x8000 ? -0x8000 : scaled || 0
    view.setInt16(HEADER_BYTES + i * BYTES_PER_SAMPLE, pcm, true)
  }
  return out
}

/**
 * The last `seconds` of a clip, for the live text: Whisper looks at 30 s and the
 * spec sends the last 28. Always a COPY, even when it is the whole clip: the
 * recording goes on growing while this pass is in flight, and a view would be
 * the capture's own buffer changing underneath the encoder.
 */
export function tailSamples(samples: Float32Array, sampleRate: number, seconds: number): Float32Array {
  const want = Math.floor(seconds * sampleRate)
  if (!(want > 0)) return new Float32Array(0) // zero, negative and NaN alike
  return samples.slice(Math.max(0, samples.length - want))
}

/**
 * From the rate the audio hardware runs at (48000 or 44100, whatever the
 * AudioContext was given) to the 16000 Whisper wants.
 *
 * Each output sample is the AVERAGE of the input samples that fall in its
 * slot. That is a box filter, not a proper low-pass, and it is enough here on
 * purpose: what aliases down is what a voice has above 8 kHz, which is little,
 * and the alternative is a windowed-sinc kernel run on every block of a live
 * recording. Picking every third sample instead would fold all of it into the
 * speech band unweakened. 44100 is not a whole multiple, so the slots are 2 and
 * 3 samples wide by turns; the edges are computed from the index each time and
 * never accumulated, so a five-minute clip does not drift.
 *
 * Returns the INPUT ITSELF when the rates already match (no copy: the caller is
 * on the audio path). A slower source, which a headset in hands-free mode can
 * be, is brought up by linear interpolation rather than refused.
 */
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError(`downsample: not a sample rate: ${fromRate} to ${toRate}`)
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const out = new Float32Array(Math.floor(input.length / ratio))

  if (ratio < 1) {
    for (let i = 0; i < out.length; i += 1) {
      const pos = i * ratio
      const a = Math.floor(pos)
      const b = Math.min(a + 1, input.length - 1)
      out[i] = input[a] + (input[b] - input[a]) * (pos - a)
    }
    return out
  }

  for (let i = 0; i < out.length; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
    let sum = 0
    for (let j = start; j < end; j += 1) sum += input[j]
    out[i] = sum / (end - start)
  }
  return out
}

/** Root mean square, 0 to 1 for a signal inside the rails: the level meter's
 *  number, and how a dead microphone shows up as one before anything is recorded. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}
