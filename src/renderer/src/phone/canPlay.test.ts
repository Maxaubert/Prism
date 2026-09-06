import { describe, expect, it } from 'vitest'
import { canTokens } from './canPlay'

// Two devices, answered the way their `canPlayType` does: Safari on an
// iPhone (HEVC, Dolby, native HLS, no VP9) and Chrome on an Android (VP9,
// AV1, Opus, MSE, no native HLS, no HEVC on most). A bare container is
// matched whole: "video/mp4" is also the start of every mp4 codec probe.
const device =
  (codecs: RegExp, containers: string[]) =>
  (m: string): string => {
    const c = /codecs="([^"]+)"/.exec(m)
    if (c) return codecs.test(c[1]) ? 'probably' : ''
    return containers.includes(m) ? 'maybe' : ''
  }
const safari = device(/^(avc1|hvc1|mp4a\.40\.2|ac-3|ec-3)/, [
  'video/mp4',
  'audio/mp4',
  'audio/mpeg',
  'audio/flac',
  'application/vnd.apple.mpegurl'
])
const chrome = device(/^(avc1|vp9|av01|mp4a\.40\.2|opus)/, [
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/flac',
  'audio/wav',
  'audio/ogg'
])

describe('canTokens', () => {
  it('reads Safari', () => {
    const t = canTokens(safari, false)
    expect(t).toEqual(expect.arrayContaining(['h264', 'hevc', 'aac', 'ac3', 'eac3', 'mp3', 'flac', 'mp4', 'hls-native']))
    expect(t).not.toContain('vp9')
    expect(t).not.toContain('mse')
  })
  it('reads Chrome, where HLS needs hls.js and MSE', () => {
    const t = canTokens(chrome, true)
    expect(t).toEqual(
      expect.arrayContaining(['h264', 'vp9', 'av1', 'aac', 'opus', 'mp3', 'flac', 'wav', 'ogg', 'mp4', 'webm', 'mse'])
    )
    expect(t).not.toContain('hls-native')
    expect(t).not.toContain('hevc')
  })
  it('a "maybe" counts: canPlayType never says "probably" for a bare container', () => {
    expect(canTokens((m) => (m === 'video/mp4' ? 'maybe' : ''), false)).toEqual(['mp4'])
  })
  it('a device that plays nothing reports nothing rather than guessing', () => {
    expect(canTokens(() => '', false)).toEqual([])
  })
})
