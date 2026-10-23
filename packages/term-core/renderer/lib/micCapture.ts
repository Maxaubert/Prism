import { downsample, rms } from './wav'

/**
 * The microphone, as 16 kHz mono samples (#13). Nothing is written anywhere:
 * the samples live in this closure until the recording ends.
 *
 * NO AudioWorklet, deliberately. A worklet is a module loaded by URL, and both
 * apps run a `script-src 'self'` policy: a blob: module is refused, and a real
 * file would have to be bundled and found by two different hosts' bundlers.
 * `MediaStreamTrackProcessor` hands the raw frames to a plain reader on this
 * thread instead, with nothing to load. Dictation audio is small (16 kHz mono
 * is 32 KB a second) so there is no case for a realtime thread.
 */
export const TARGET_RATE = 16000

export interface Capture {
  /** Everything heard so far, at 16 kHz. A copy: the caller may keep it. */
  snapshot(): Float32Array
  /** Seconds recorded so far. */
  seconds(): number
  stop(): void
}

export type CaptureFailure = 'no-device' | 'denied' | 'unsupported' | 'failed'

interface AudioDataLike {
  sampleRate: number
  numberOfFrames: number
  numberOfChannels: number
  copyTo(dest: Float32Array, opts: { planeIndex: number; format: string }): void
  close(): void
}
type ProcessorCtor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<AudioDataLike> }

export function captureFailure(err: unknown): CaptureFailure {
  const name = (err as { name?: string } | null)?.name ?? ''
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device'
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  return 'failed'
}

/**
 * Open the mic. `onLevel` gets a 0..1 loudness per frame, which is the whole
 * point of the pill's meter: a dead or muted microphone is visible while you
 * speak, not after. Rejects with a CaptureFailure.
 */
export async function startCapture(opts: {
  deviceId?: string
  onLevel?: (level: number) => void
}): Promise<Capture> {
  const Processor = (globalThis as unknown as { MediaStreamTrackProcessor?: ProcessorCtor })
    .MediaStreamTrackProcessor
  if (!Processor || !navigator.mediaDevices?.getUserMedia) throw 'unsupported' satisfies CaptureFailure

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
        channelCount: 1,
        // Takes this page's own output (the start cue) out of the recording.
        echoCancellation: true,
        // Whisper was trained on raw audio; a denoiser's artefacts cost more
        // words than the noise does. Gain control stays: quiet mics are common.
        noiseSuppression: false,
        autoGainControl: true
      }
    })
  } catch (err) {
    throw captureFailure(err)
  }

  const track = stream.getAudioTracks()[0]
  if (!track) {
    stream.getTracks().forEach((t) => t.stop())
    throw 'no-device' satisfies CaptureFailure
  }

  const chunks: Float32Array[] = []
  let total = 0
  let live = true
  const reader = new Processor({ track }).readable.getReader()

  void (async () => {
    try {
      while (live) {
        const { value, done } = await reader.read()
        if (done || !value) break
        const frame = new Float32Array(value.numberOfFrames)
        // Plane 0 only: a stereo device's left channel is the voice as well as
        // its mix is, and asking for a mix is one more thing to get wrong.
        value.copyTo(frame, { planeIndex: 0, format: 'f32-planar' })
        const rate = value.sampleRate
        value.close()
        if (!live) break
        const out = downsample(frame, rate, TARGET_RATE)
        chunks.push(out)
        total += out.length
        // Speech RMS sits around 0.02-0.2; scaled so ordinary talking fills
        // most of the meter and silence reads as empty.
        opts.onLevel?.(Math.min(1, rms(out) * 6))
      }
    } catch {
      /* the track ended under us: what was heard so far still stands */
    }
  })()

  return {
    snapshot() {
      const all = new Float32Array(total)
      let at = 0
      for (const c of chunks) {
        all.set(c, at)
        at += c.length
      }
      return all
    },
    seconds: () => total / TARGET_RATE,
    stop() {
      if (!live) return
      live = false
      void reader.cancel().catch(() => {})
      stream.getTracks().forEach((t) => t.stop())
      opts.onLevel?.(0)
    }
  }
}

/** The input devices, for the picker. Labels are empty until permission was given once. */
export async function listMics(): Promise<Array<{ id: string; label: string }>> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
  } catch {
    return []
  }
}
