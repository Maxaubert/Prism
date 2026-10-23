import { describe, expect, it } from 'vitest'
import { downsample, encodeWav, rms, tailSamples } from './wav'

const ascii = (bytes: Uint8Array, at: number, len: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + len))

/** A sine with a little phase, so no sample sits exactly on zero and a crossing
 *  is never counted twice or missed. */
function sine(hz: number, rate: number, seconds: number, amp = 0.8): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds))
  for (let i = 0; i < out.length; i += 1) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate + 0.3)
  return out
}

function zeroCrossings(s: Float32Array): number {
  let n = 0
  for (let i = 1; i < s.length; i += 1) if (s[i - 1] < 0 !== s[i] < 0) n += 1
  return n
}

describe('encodeWav', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
  const wav = encodeWav(samples, 16000)
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)

  it('is 44 bytes of header and two bytes a sample', () => {
    expect(wav).toBeInstanceOf(Uint8Array)
    expect(wav.length).toBe(44 + samples.length * 2)
    expect(encodeWav(new Float32Array(16000), 16000).length).toBe(44 + 32000)
  })

  it('writes the RIFF header field by field', () => {
    expect(ascii(wav, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 10) // the file, less these first eight bytes
    expect(ascii(wav, 8, 4)).toBe('WAVE')
    expect(ascii(wav, 12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16) // size of the fmt chunk
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16000) // sample rate
    expect(view.getUint32(28, true)).toBe(32000) // bytes a second
    expect(view.getUint16(32, true)).toBe(2) // block align
    expect(view.getUint16(34, true)).toBe(16) // bits a sample
    expect(ascii(wav, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(10)
  })

  it('carries the rate it was given into both rate fields', () => {
    const v = new DataView(encodeWav(new Float32Array(4), 48000).buffer)
    expect(v.getUint32(24, true)).toBe(48000)
    expect(v.getUint32(28, true)).toBe(96000)
  })

  it('writes little-endian signed 16-bit samples, full scale at the rails', () => {
    const at = (i: number): number => view.getInt16(44 + i * 2, true)
    expect(at(0)).toBe(0)
    expect(at(1)).toBe(16384)
    expect(at(2)).toBe(-16384)
    expect(at(3)).toBe(32767)
    expect(at(4)).toBe(-32768)
  })

  it('clamps what is outside [-1, 1] instead of wrapping it round', () => {
    const v = new DataView(encodeWav(new Float32Array([1.7, -3, Infinity, -Infinity, NaN]), 16000).buffer)
    const got = [0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true))
    expect(got).toEqual([32767, -32768, 32767, -32768, 0])
  })

  it('an empty clip is a valid, empty file', () => {
    const empty = encodeWav(new Float32Array(0), 16000)
    const v = new DataView(empty.buffer)
    expect(empty.length).toBe(44)
    expect(v.getUint32(4, true)).toBe(36)
    expect(v.getUint32(40, true)).toBe(0)
  })

  it('reads a subarray from where it starts, not from the start of its buffer', () => {
    const whole = new Float32Array([0.25, 0.25, -1, 1])
    const v = new DataView(encodeWav(whole.subarray(2), 16000).buffer)
    expect(v.getUint32(40, true)).toBe(4)
    expect(v.getInt16(44, true)).toBe(-32768)
    expect(v.getInt16(46, true)).toBe(32767)
  })
})

describe('tailSamples', () => {
  const ramp = Float32Array.from({ length: 100 }, (_, i) => i)

  it('is the last N seconds', () => {
    const tail = tailSamples(ramp, 10, 3)
    expect(tail.length).toBe(30)
    expect(tail[0]).toBe(70)
    expect(tail[29]).toBe(99)
  })

  it("is Whisper's 28 s window of a long clip", () => {
    const clip = new Float32Array(16000 * 40)
    expect(tailSamples(clip, 16000, 28).length).toBe(16000 * 28)
  })

  it('is the whole clip when the clip is shorter than the window', () => {
    const tail = tailSamples(ramp, 10, 28)
    expect(Array.from(tail)).toEqual(Array.from(ramp))
    expect(tailSamples(ramp, 10, 10).length).toBe(100)
  })

  it('is a copy: the recording goes on growing underneath it', () => {
    const source = Float32Array.from([1, 2, 3, 4])
    const tail = tailSamples(source, 1, 2)
    const all = tailSamples(source, 1, 99)
    source.fill(9)
    expect(Array.from(tail)).toEqual([3, 4])
    expect(Array.from(all)).toEqual([1, 2, 3, 4])
    expect(tail.buffer).not.toBe(source.buffer)
  })

  it('is empty for no time, negative time and an empty clip', () => {
    expect(tailSamples(ramp, 10, 0).length).toBe(0)
    expect(tailSamples(ramp, 10, -1).length).toBe(0)
    expect(tailSamples(ramp, 10, NaN).length).toBe(0)
    expect(tailSamples(new Float32Array(0), 16000, 28).length).toBe(0)
  })

  it('rounds a fraction of a sample down', () => {
    expect(tailSamples(ramp, 10, 0.25).length).toBe(2)
  })
})

describe('downsample', () => {
  it('hands the input back when the rates match', () => {
    const input = sine(440, 16000, 0.1)
    expect(downsample(input, 16000, 16000)).toBe(input)
  })

  it.each([
    [48000, 16000],
    [44100, 16000],
    [96000, 16000],
    [32000, 16000]
  ])('%i to %i: a second in is a second out', (from, to) => {
    expect(downsample(new Float32Array(from), from, to).length).toBe(to)
    expect(downsample(new Float32Array(from / 2), from, to).length).toBe(to / 2)
  })

  it.each([48000, 44100])('a 1 kHz sine at %i stays a 1 kHz sine', (from) => {
    const out = downsample(sine(1000, from, 1), from, 16000)
    // Two crossings a cycle; the ends of the clip may cost one.
    expect(Math.abs(zeroCrossings(out) - 2000)).toBeLessThanOrEqual(2)
    // And it is still a sine of about that size, not a thinned-out or clipped one.
    expect(rms(out)).toBeGreaterThan((0.8 / Math.SQRT2) * 0.9)
    expect(rms(out)).toBeLessThan((0.8 / Math.SQRT2) * 1.01)
  })

  it('averages, so steady level in is the same level out', () => {
    const out = downsample(new Float32Array(44100).fill(0.5), 44100, 16000)
    expect(Math.min(...out)).toBeCloseTo(0.5, 6)
    expect(Math.max(...out)).toBeCloseTo(0.5, 6)
  })

  it('averages each window rather than picking a sample out of it', () => {
    expect(Array.from(downsample(Float32Array.from([1, 0, 0, 1, 0, 0]), 48000, 16000))).toEqual([
      expect.closeTo(1 / 3, 6),
      expect.closeTo(1 / 3, 6)
    ])
  })

  it('takes a slow microphone up to 16 kHz as well', () => {
    const out = downsample(sine(300, 8000, 1), 8000, 16000)
    expect(out.length).toBe(16000)
    expect(Math.abs(zeroCrossings(out) - 600)).toBeLessThanOrEqual(2)
  })

  it('copes with nothing, and refuses a rate that is not one', () => {
    expect(downsample(new Float32Array(0), 48000, 16000).length).toBe(0)
    expect(() => downsample(new Float32Array(4), 0, 16000)).toThrow(RangeError)
    expect(() => downsample(new Float32Array(4), 48000, -1)).toThrow(RangeError)
  })
})

describe('rms', () => {
  it('is 0 for silence and for nothing at all', () => {
    expect(rms(new Float32Array(1000))).toBe(0)
    expect(rms(new Float32Array(0))).toBe(0)
  })
  it('is the level of a steady signal, whichever way it points', () => {
    expect(rms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5, 6)
    expect(rms(new Float32Array(100).fill(-0.5))).toBeCloseTo(0.5, 6)
  })
  it('is amplitude over root two for a sine', () => {
    expect(rms(sine(1000, 16000, 1, 1))).toBeCloseTo(Math.SQRT1_2, 3)
  })
  it('is 1 for a full-scale square wave', () => {
    expect(rms(Float32Array.from({ length: 64 }, (_, i) => (i % 2 ? 1 : -1)))).toBeCloseTo(1, 6)
  })
})
