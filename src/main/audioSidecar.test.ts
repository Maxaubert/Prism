import { describe, expect, it } from 'vitest'
import { parseSidecarUrl } from './audioSidecar'

const url = (p: string, s: number | string, d: number | string): string =>
  `fsaudio://track/${encodeURIComponent(p)}?s=${s}&d=${d}`

describe('the fsaudio url', () => {
  it('carries a path, a track and a duration', () => {
    const r = parseSidecarUrl(url('C:\\films\\Zoolander.mkv', 1, 5387.392))
    expect(r).toEqual({ file: 'C:\\films\\Zoolander.mkv', stream: 1, duration: 5387.392 })
  })

  it('survives spaces, hashes and percent signs in a film name', () => {
    const p = 'C:\\films\\A film #2 (100% grain).mkv'
    expect(parseSidecarUrl(url(p, 0, 12))?.file).toBe(p)
  })

  it('accepts -1, the blind route', () => {
    expect(parseSidecarUrl(url('x.mkv', -1, 12))?.stream).toBe(-1)
  })

  it('refuses anything it cannot trust', () => {
    expect(parseSidecarUrl('not a url')).toBeNull()
    expect(parseSidecarUrl('fsaudio://track/?s=0&d=1')).toBeNull() // no file
    expect(parseSidecarUrl(url('x.mkv', 'abc', 12))).toBeNull()
    expect(parseSidecarUrl(url('x.mkv', 1.5, 12))).toBeNull()
    expect(parseSidecarUrl(url('x.mkv', -2, 12))).toBeNull()
    expect(parseSidecarUrl(url('x.mkv', 0, 0))).toBeNull() // a zero-length track
    expect(parseSidecarUrl(url('x.mkv', 0, -5))).toBeNull()
    expect(parseSidecarUrl(url('x.mkv', 0, 'soon'))).toBeNull()
  })
})
