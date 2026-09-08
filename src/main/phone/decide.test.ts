import { describe, expect, it } from 'vitest'
import type { MediaInfo } from '../ffmpeg'
import { decide, isHdr, parseCan } from './decide'

const info = (o: {
  videoCodec?: string | null
  audioCodec?: string | null
  height?: number
  transfer?: string
}): MediaInfo => ({
  audio:
    o.audioCodec === null
      ? null
      : { index: 1, title: '', codec: o.audioCodec ?? 'aac', channels: 2, layout: 'stereo', language: '', duration: 100 },
  tracks: [],
  videoCodec: o.videoCodec === undefined ? 'h264' : o.videoCodec,
  fps: 24,
  duration: 100,
  video: o.videoCodec === null ? null : { width: 1920, height: o.height ?? 1080, pixFmt: 'yuv420p', transfer: o.transfer ?? 'bt709' }
})

const iphone = parseCan('h264,hevc,aac,mp3,flac,ac3,eac3,mp4,webm,hls-native')
const android = parseCan('h264,vp9,av1,aac,mp3,flac,opus,mp4,webm')

describe('decide', () => {
  it('plays an mp4 of h264 + aac directly on anything', () => {
    expect(decide(info({}), '.mp4', iphone)).toEqual({ mode: 'direct' })
    expect(decide(info({}), '.mp4', android)).toEqual({ mode: 'direct' })
  })
  it('an mkv is never direct: the container decides before the codecs', () => {
    expect(decide(info({}), '.mkv', iphone)).toMatchObject({ mode: 'hls', copyVideo: true, copyAudio: true })
  })
  it('a direct container with a codec the phone lacks is hls', () => {
    expect(decide(info({ videoCodec: 'hevc' }), '.mp4', android)).toMatchObject({ mode: 'hls', copyVideo: false, copyAudio: true })
    expect(decide(info({ videoCodec: 'hevc' }), '.MP4', iphone)).toEqual({ mode: 'direct' })
  })
  it('copies what the phone plays and encodes what it does not', () => {
    expect(decide(info({ videoCodec: 'hevc', audioCodec: 'ac3' }), '.mkv', iphone)).toMatchObject({ mode: 'hls', copyVideo: true, copyAudio: true })
    expect(decide(info({ videoCodec: 'hevc', audioCodec: 'ac3' }), '.mkv', android)).toMatchObject({ mode: 'hls', copyVideo: false, copyAudio: false })
    expect(decide(info({ videoCodec: 'mpeg4' }), '.avi', iphone)).toMatchObject({ mode: 'hls', copyVideo: false, copyAudio: true })
  })
  it('re-encodes audio HLS is strict about, even when the phone plays it in a file', () => {
    // Opus plays in a webm on Android; in fMP4 segments it is not a safe bet.
    expect(decide(info({ videoCodec: 'vp9', audioCodec: 'opus' }), '.mkv', android)).toMatchObject({ mode: 'hls', copyVideo: true, copyAudio: false })
  })
  it('caps an encode at 1080p and leaves a copy at its own size', () => {
    expect(decide(info({ videoCodec: 'hevc', height: 2160 }), '.mkv', android)).toMatchObject({ copyVideo: false, height: 1080 })
    expect(decide(info({ videoCodec: 'hevc', height: 2160 }), '.mkv', iphone)).toMatchObject({ copyVideo: true, height: null })
    expect(decide(info({ videoCodec: 'mpeg4', height: 720 }), '.avi', android)).toMatchObject({ copyVideo: false, height: null })
  })
  it('tone-maps HDR only when it encodes', () => {
    expect(isHdr('smpte2084')).toBe(true)
    expect(isHdr('arib-std-b67')).toBe(true)
    expect(isHdr('bt709')).toBe(false)
    expect(isHdr('')).toBe(false)
    expect(decide(info({ videoCodec: 'hevc', transfer: 'smpte2084' }), '.mkv', android)).toMatchObject({ copyVideo: false, tonemap: true })
    expect(decide(info({ videoCodec: 'hevc', transfer: 'smpte2084' }), '.mkv', iphone)).toMatchObject({ copyVideo: true, tonemap: false })
  })
  it('audio-only files: direct when the container and codec play, else an audio HLS', () => {
    expect(decide(info({ videoCodec: null, audioCodec: 'mp3' }), '.mp3', android)).toEqual({ mode: 'direct' })
    expect(decide(info({ videoCodec: null, audioCodec: 'flac' }), '.flac', iphone)).toEqual({ mode: 'direct' })
    expect(decide(info({ videoCodec: null, audioCodec: 'wmav2' }), '.wma', iphone)).toMatchObject({ mode: 'hls', audioOnly: true, copyAudio: false, copyVideo: false, tonemap: false, height: null })
    expect(decide(info({ videoCodec: null, audioCodec: 'opus' }), '.ogg', iphone)).toMatchObject({ mode: 'hls', audioOnly: true })
  })
  it('a wav is its container: the phone reports wav, not the pcm codec', () => {
    const wav = parseCan('aac,mp3,wav,mp4')
    expect(decide(info({ videoCodec: null, audioCodec: 'pcm_s16le' }), '.wav', wav)).toEqual({ mode: 'direct' })
    expect(decide(info({ videoCodec: null, audioCodec: 'pcm_s16le' }), '.wav', android)).toMatchObject({ mode: 'hls', audioOnly: true })
  })
  it('a file with a picture and no sound still plays', () => {
    expect(decide(info({ audioCodec: null }), '.mp4', android)).toEqual({ mode: 'direct' })
    expect(decide(info({ audioCodec: null }), '.mkv', android)).toMatchObject({ mode: 'hls', copyVideo: true, copyAudio: false, audioOnly: false })
  })
  it('gives up honestly with no probe', () => {
    expect(decide(null, '.mkv', iphone)).toEqual({ mode: 'none', reason: 'Prism could not read this file' })
  })
  it('parses the can list defensively', () => {
    expect([...parseCan(' H264, aac ,,x')]).toEqual(['h264', 'aac', 'x'])
    expect(parseCan(null).size).toBe(0)
    expect(parseCan(undefined).size).toBe(0)
  })
})
