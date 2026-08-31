import { describe, expect, it } from 'vitest'
import { cacheName, convertArgs, planConversion, readProgress, type ConvertPlan } from './videoConvert'
import type { MediaInfo } from './ffmpeg'

const info = (videoCodec: string | null, audioCodec?: string): MediaInfo => {
  const audio = audioCodec
    ? {
        index: 1,
        title: '',
        codec: audioCodec,
        channels: 2,
        layout: 'stereo',
        language: '',
        duration: 100
      }
    : null
  return { videoCodec, fps: 25, duration: 100, audio, tracks: audio ? [audio] : [] }
}

describe('deciding what to convert', () => {
  it('leaves a file Chromium can already play alone', () => {
    expect(planConversion(info('h264', 'aac'), '.mp4').needed).toBe(false)
    expect(planConversion(info('vp9', 'opus'), '.webm').needed).toBe(false)
    expect(planConversion(info('hevc', 'aac'), '.mkv').needed).toBe(false)
  })

  it('COPIES the streams when only the container is wrong', () => {
    // The common case, and the cheap one: .flv, .m2ts and .vob usually hold
    // H.264 that Chromium could decode if it could open the box.
    const p = planConversion(info('h264', 'aac'), '.flv')
    expect(p).toEqual({ needed: true, copyVideo: true, copyAudio: true, reason: 'container' })
  })

  it('re-encodes a picture Chromium cannot decode', () => {
    for (const codec of ['mpeg2video', 'mpeg4', 'msmpeg4v3', 'wmv2', 'theora', 'prores', 'ffv1']) {
      const p = planConversion(info(codec, 'aac'), '.mkv')
      expect(p.needed, codec).toBe(true)
      expect(p.copyVideo, codec).toBe(false)
      expect(p.reason, codec).toBe('codec')
    }
  })

  it('re-encodes audio that would still be undecodable in the new file', () => {
    // Copying AC-3 into the mp4 would just move the silence along with it.
    expect(planConversion(info('h264', 'ac3'), '.m2ts').copyAudio).toBe(false)
    expect(planConversion(info('h264', 'aac'), '.m2ts').copyAudio).toBe(true)
  })

  it('is not interested in audio-only files, which the sidecar owns', () => {
    expect(planConversion(info(null, 'ac3'), '.wma').needed).toBe(false)
  })

  it('says nothing when nothing could be probed', () => {
    expect(planConversion(null, '.mpg').needed).toBe(false)
  })
})

describe('the conversion command', () => {
  const plan = (over: Partial<ConvertPlan> = {}): ConvertPlan => ({
    needed: true,
    copyVideo: false,
    copyAudio: false,
    reason: 'codec',
    ...over
  })

  it('copies rather than encodes when it can', () => {
    const a = convertArgs('in.flv', 'out.mp4', plan({ copyVideo: true, copyAudio: true })).join(' ')
    expect(a).toContain('-c:v copy')
    expect(a).toContain('-c:a copy')
    expect(a).not.toContain('libopenh264')
  })

  it('encodes with the LGPL encoder, since there is no x264 here', () => {
    expect(convertArgs('in.avi', 'out.mp4', plan()).join(' ')).toContain('-c:v libopenh264')
  })

  it('survives a file with no audio at all', () => {
    // The '?' is what stops a silent film failing the whole conversion.
    expect(convertArgs('in.avi', 'out.mp4', plan())).toContain('0:a:0?')
  })

  it('puts the index at the front so the copy seeks at once', () => {
    expect(convertArgs('in.avi', 'out.mp4', plan()).join(' ')).toContain('-movflags +faststart')
  })

  it('passes paths as arguments, never a command line', () => {
    const weird = 'C:\\films\\a "quoted" & piped; name.avi'
    expect(convertArgs(weird, 'out.mp4', plan())).toContain(weird)
  })
})

describe('progress', () => {
  it('reads a percentage out of ffmpeg chatter', () => {
    expect(readProgress('out_time_ms=50000000\nspeed=2x\n', 100)).toBe(50)
    expect(readProgress('out_time_ms=1000000\n', 100)).toBe(1)
  })

  it('takes the LAST reading in a chunk, not the first', () => {
    expect(readProgress('out_time_ms=1000000\nout_time_ms=90000000\n', 100)).toBe(90)
  })

  it('never reports done early, and reports done at the end', () => {
    expect(readProgress('out_time_ms=999000000\n', 100)).toBe(99)
    expect(readProgress('out_time_ms=100000000\nprogress=end\n', 100)).toBe(100)
  })

  it('says nothing when the length is unknown', () => {
    expect(readProgress('out_time_ms=5000000\n', 0)).toBeNull()
  })
})

describe('the cache name', () => {
  it('is the same for the same file, and different after an edit', () => {
    expect(cacheName('C:\\a.avi', 111, 900)).toBe(cacheName('C:\\a.avi', 111, 900))
    expect(cacheName('C:\\a.avi', 111, 900)).not.toBe(cacheName('C:\\a.avi', 222, 900))
    expect(cacheName('C:\\a.avi', 111, 900)).not.toBe(cacheName('C:\\a.avi', 111, 901))
  })

  it('ignores the case Windows itself ignores', () => {
    expect(cacheName('C:\\Films\\A.AVI', 1, 2)).toBe(cacheName('c:\\films\\a.avi', 1, 2))
  })

  it('is a plain file name, whatever the source was called', () => {
    expect(cacheName('C:\\a b\\../weird "name".avi', 1, 2)).toMatch(/^[0-9a-f]{32}\.mp4$/)
  })
})
