import { describe, expect, it } from 'vitest'
import { BUCKETS, PEAKS_RATE, foldChunk, normalise, peaksArgs } from './peaks'

const acc = (duration: number, buckets = BUCKETS) => ({
  peaks: new Array<number>(buckets).fill(0),
  samples: 0,
  perBucket: Math.max(1, Math.floor((duration * PEAKS_RATE) / buckets)),
  odd: null as number | null
})

/** `n` samples of constant amplitude, as ffmpeg would emit them. */
const pcm = (values: number[]): Buffer => {
  const b = Buffer.alloc(values.length * 2)
  values.forEach((v, i) => b.writeInt16LE(v, i * 2))
  return b
}

describe('peaksArgs', () => {
  it('asks for the FIRST audio track, mono, and raw samples', () => {
    const a = peaksArgs('C:\film.mkv')
    expect(a).toContain('0:a:0?') // '?' - a file with no audio is not an error
    expect(a.join(' ')).toContain('-ac 1')
    expect(a.join(' ')).toContain('-f s16le')
    expect(a[a.length - 1]).toBe('-') // to stdout, never a temp file
  })
})

describe('foldChunk', () => {
  it('keeps the loudest sample in each bucket, not the last', () => {
    const a = acc(BUCKETS / PEAKS_RATE, 4) // 1 sample per bucket... make it 2
    a.perBucket = 2
    foldChunk(pcm([1000, 32767, 500, 100, 0, 0, 0, 0]), a)
    expect(a.peaks[0]).toBeCloseTo(1, 2)
    expect(a.peaks[1]).toBeCloseTo(500 / 32768, 3)
  })

  it('measures amplitude, so a negative trough counts as loud', () => {
    const a = acc(1, 2)
    a.perBucket = 2
    foldChunk(pcm([-32000, 10, 5, 5]), a)
    expect(a.peaks[0]).toBeGreaterThan(0.9)
  })

  it('survives a sample split across two chunks', () => {
    // The stream arrives in arbitrary chunks; half a sample must not be read
    // as a whole one, or every peak after it is off by a byte.
    const whole = pcm([0, 32767, 0, 0])
    const a = acc(1, 4)
    a.perBucket = 1
    foldChunk(whole.subarray(0, 3), a)
    foldChunk(whole.subarray(3), a)
    expect(a.peaks[1]).toBeCloseTo(1, 2)
    expect(a.samples).toBe(4)
  })

  it('never runs off the end of the bucket list', () => {
    // A file longer than its probed duration (VBR, a bad header) must not
    // write past the array.
    const a = acc(1, 3)
    a.perBucket = 1
    foldChunk(pcm([100, 100, 100, 100, 100, 100]), a)
    expect(a.peaks).toHaveLength(3)
  })

  it('holds nothing but the buckets, whatever the stream size', () => {
    const a = acc(7200, 160) // a two-hour film
    for (let i = 0; i < 50; i++) foldChunk(pcm(new Array(4096).fill(1234)), a)
    expect(a.peaks).toHaveLength(160)
    expect(Object.keys(a)).toEqual(['peaks', 'samples', 'perBucket', 'odd'])
  })
})

describe('normalise', () => {
  it('scales the loudest bucket to 1', () => {
    expect(Math.max(...normalise([0.1, 0.25, 0.05]))).toBeCloseTo(1, 5)
  })

  it('lifts the quiet ones so they are still visible', () => {
    const [quiet] = normalise([0.01, 1])
    expect(quiet).toBeGreaterThan(0.01) // the 0.7 curve, not a straight ratio
  })

  it('has an answer for silence rather than dividing by zero', () => {
    expect(normalise([0, 0, 0]).every((v) => Number.isFinite(v))).toBe(true)
  })
})
