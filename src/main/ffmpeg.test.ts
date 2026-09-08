import { describe, expect, it } from 'vitest'
import {
  BYTES_PER_SEC,
  chromiumCanDemux,
  readProbe,
  FIRST_AUDIO,
  ffmpegDirs,
  needsSidecar,
  parseRange,
  sidecarArgs,
  sidecarSize,
  timeForByte,
  wavHeader,
  WAV_HEADER_BYTES
} from './ffmpeg'

describe('what Chromium can play', () => {
  it('leaves the formats it decodes alone', () => {
    for (const c of ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le']) {
      expect(needsSidecar(c), c).toBe(false)
    }
  })

  it('takes over the ones it cannot', () => {
    // The reported bug: a DD 5.1 rip playing picture-only.
    for (const c of ['ac3', 'eac3', 'dts', 'truehd', 'mlp', 'ac4', 'wmav2', 'alac']) {
      expect(needsSidecar(c), c).toBe(true)
    }
  })

  it('is case-insensitive, and decodes the unknown rather than risking silence', () => {
    expect(needsSidecar('AC3')).toBe(true)
    expect(needsSidecar('AAC')).toBe(false)
    expect(needsSidecar('something_new')).toBe(true)
    expect(needsSidecar(undefined)).toBe(false) // nothing claimed, nothing to do
  })
})

describe('the virtual WAV', () => {
  it('is a real RIFF header for the size it promises', () => {
    const h = wavHeader(BYTES_PER_SEC) // one second
    expect(h.length).toBe(WAV_HEADER_BYTES)
    expect(h.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(h.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(h.subarray(36, 40).toString('ascii')).toBe('data')
    expect(h.readUInt32LE(4)).toBe(36 + BYTES_PER_SEC) // RIFF size
    expect(h.readUInt32LE(40)).toBe(BYTES_PER_SEC) // data size
    expect(h.readUInt16LE(22)).toBe(2) // stereo
    expect(h.readUInt32LE(24)).toBe(48000)
    expect(h.readUInt16LE(34)).toBe(16) // bits
  })

  it('sizes a track from its duration', () => {
    expect(sidecarSize(1)).toBe(WAV_HEADER_BYTES + BYTES_PER_SEC)
    expect(sidecarSize(0)).toBe(WAV_HEADER_BYTES)
    expect(sidecarSize(-4)).toBe(WAV_HEADER_BYTES)
    expect(sidecarSize(NaN)).toBe(WAV_HEADER_BYTES)
    // The reported film: 89 minutes 47 seconds.
    expect(sidecarSize(5387.392)).toBe(WAV_HEADER_BYTES + Math.floor(5387.392 * 48000) * 4)
  })

  it('maps a byte back to the second it holds - the whole trick', () => {
    expect(timeForByte(0)).toBe(0)
    expect(timeForByte(WAV_HEADER_BYTES)).toBe(0)
    expect(timeForByte(WAV_HEADER_BYTES + BYTES_PER_SEC)).toBe(1)
    expect(timeForByte(WAV_HEADER_BYTES + BYTES_PER_SEC * 1800)).toBe(1800)
  })

  it('lands a byte inside a frame on that frame, never half a sample in', () => {
    // Half a sample of skew would swap left and right for the rest of the film.
    const mid = WAV_HEADER_BYTES + BYTES_PER_SEC + 3
    expect(timeForByte(mid) * 48000).toBe(48000)
  })

  it('round-trips: the byte for a time gives that time back', () => {
    for (const t of [0, 0.5, 12.25, 1800, 5387]) {
      expect(timeForByte(WAV_HEADER_BYTES + Math.floor(t * 48000) * 4)).toBeCloseTo(t, 6)
    }
  })
})

describe('Range headers', () => {
  const total = 1000

  it('reads an open-ended range', () => {
    expect(parseRange('bytes=0-', total)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=500-', total)).toEqual({ start: 500, end: 999 })
  })

  it('reads a closed one, and clamps past the end', () => {
    expect(parseRange('bytes=0-99', total)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=900-99999', total)).toEqual({ start: 900, end: 999 })
  })

  it('reads a suffix range', () => {
    expect(parseRange('bytes=-200', total)).toEqual({ start: 800, end: 999 })
  })

  it('refuses nonsense rather than serving the wrong seconds', () => {
    expect(parseRange(null, total)).toBeNull()
    expect(parseRange('bytes=', total)).toBeNull()
    expect(parseRange('seconds=0-1', total)).toBeNull()
    expect(parseRange('bytes=900-100', total)).toBeNull()
    expect(parseRange('bytes=abc-def', total)).toBeNull()
  })
})

describe('the ffmpeg command', () => {
  it('starts where the range asks, and emits our exact PCM', () => {
    const a = sidecarArgs('C:\\films\\x.mkv', 1, 1800)
    expect(a).toContain('-vn')
    expect(a.join(' ')).toContain('-ss 1800.000000')
    expect(a.join(' ')).toContain('-map 0:1')
    expect(a.join(' ')).toContain('-ac 2')
    expect(a.join(' ')).toContain('-ar 48000')
    expect(a.join(' ')).toContain('-f s16le')
    expect(a[a.length - 1]).toBe('pipe:1')
  })

  it('leaves -ss off at the start of a file', () => {
    expect(sidecarArgs('x.mkv', 1, 0)).not.toContain('-ss')
  })

  it('names the first audio track when nothing probed the file', () => {
    expect(sidecarArgs('x.mkv', FIRST_AUDIO, 0).join(' ')).toContain('-map 0:a:0')
  })

  it('passes the path as one argument, never a command line', () => {
    // The file name is user data; it goes in argv, and nothing quotes or
    // splits it. A shell is never involved.
    const weird = 'C:\\films\\a "quoted" & piped; name.mkv'
    expect(sidecarArgs(weird, 0, 0)).toContain(weird)
  })
})

describe('containers Chromium cannot open at all', () => {
  it('knows the ones it can', () => {
    for (const e of ['.mp4', '.mkv', '.webm', '.mp3', '.m4a', '.flac', '.wav', '.avi']) {
      expect(chromiumCanDemux(e), e).toBe(true)
    }
    // MPEG-TS is NOT one of them, measured: an .m2ts opened with no picture
    // and the error banner up. Claiming it here left the file unconverted.
    for (const e of ['.ts', '.m2ts', '.mts']) expect(chromiumCanDemux(e), e).toBe(false)
  })

  it('sends the rest through the decoder whatever the codec says', () => {
    // A WMA in an ASF container, a raw AC-3 stream, an AIFF: Chromium has no
    // demuxer for any of them, so even a track it could decode is unreachable.
    for (const e of ['.wma', '.asf', '.ac3', '.dts', '.aiff', '.au', '.amr', '.ape']) {
      expect(needsSidecar('flac', e), e).toBe(true)
    }
  })

  it('leaves an ordinary file alone', () => {
    expect(needsSidecar('aac', '.m4a')).toBe(false)
    expect(needsSidecar('alac', '.m4a')).toBe(true) // codec, not container
  })
})

describe('reading a probe', () => {
  const probe = (streams: unknown[], duration = '5387.392'): string =>
    JSON.stringify({ streams, format: { duration } })

  it('reads codec, channels, layout and duration', () => {
    const t = readProbe(
      probe([
        { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6, channel_layout: '5.1(side)', tags: { language: 'eng' } }
      ])
    )?.audio
    expect(t).toEqual({ index: 1, title: '', codec: 'ac3', channels: 6, layout: '5.1(side)', language: 'eng', duration: 5387.392 })
  })

  it('names the video stream, so a picture it cannot show can be explained', () => {
    const r = readProbe(
      probe([
        { index: 0, codec_type: 'video', codec_name: 'mpeg2video' },
        { index: 1, codec_type: 'audio', codec_name: 'aac' }
      ])
    )
    expect(r?.videoCodec).toBe('mpeg2video')
    expect(r?.audio?.index).toBe(1)
  })

  it('reads the picture shape and transfer, for the phone transcode', () => {
    const r = readProbe(
      probe([
        { index: 0, codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160, pix_fmt: 'yuv420p10le', color_transfer: 'smpte2084' },
        { index: 1, codec_type: 'audio', codec_name: 'eac3', channels: 8 }
      ])
    )
    expect(r?.video).toEqual({ width: 3840, height: 2160, pixFmt: 'yuv420p10le', transfer: 'smpte2084' })
    const none = readProbe(probe([{ index: 1, codec_type: 'audio', codec_name: 'aac' }]))
    expect(none?.video).toBeNull()
  })

  it('prefers the default track, which is the one Chromium would play', () => {
    const r = readProbe(
      probe([
        { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6 },
        { index: 2, codec_type: 'audio', codec_name: 'aac', channels: 2, disposition: { default: 1 } }
      ])
    )
    expect(r?.audio?.index).toBe(2)
    expect(r?.audio?.codec).toBe('aac')
  })

  it('handles a file with no audio at all', () => {
    const r = readProbe(probe([{ index: 0, codec_type: 'video', codec_name: 'h264' }]))
    expect(r?.audio).toBeNull()
    expect(r?.videoCodec).toBe('h264')
  })

  it('says nothing rather than guessing', () => {
    expect(readProbe('not json')).toBeNull()
    expect(readProbe(probe([]))).toBeNull()
    // A track with no index cannot be mapped, so it is not a track we can use.
    expect(readProbe(probe([{ codec_type: 'audio', codec_name: 'ac3' }]))).toBeNull()
  })
})

describe('where ffmpeg is looked for', () => {
  it('prefers what the installer shipped', () => {
    const dirs = ffmpegDirs(true, 'C:\\app\\resources', 'C:\\app\\resources\\app.asar')
    expect(dirs[0]).toBe('C:\\app\\resources\\bin')
  })

  it('walks up to the vendor folder when running from a build dir', () => {
    // e2e runs out/main/index.js, so vendor is two levels up.
    const dirs = ffmpegDirs(false, '', 'C:\\repo\\out\\main')
    expect(dirs).toContain('C:\\repo\\vendor\\ffmpeg')
  })

  it('never looks in resources unless packaged', () => {
    const dirs = ffmpegDirs(false, 'C:\\app\\resources', 'C:\\repo')
    expect(dirs.some((d) => d.startsWith('C:\\app\\resources'))).toBe(false)
  })
})

describe('every audio track, for the picker', () => {
  const probe = (streams: unknown[], duration = '5387.392'): string =>
    JSON.stringify({ streams, format: { duration } })

  it('keeps them all in file order, with names and languages', () => {
    const r = readProbe(
      probe([
        { index: 0, codec_type: 'video', codec_name: 'h264' },
        { index: 1, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { language: 'eng' } },
        {
          index: 2,
          codec_type: 'audio',
          codec_name: 'aac',
          channels: 2,
          tags: { language: 'fra', title: 'Commentary' }
        }
      ])
    )
    expect(r?.tracks.map((t) => [t.index, t.language, t.title])).toEqual([
      [1, 'eng', ''],
      [2, 'fra', 'Commentary']
    ])
  })

  it('still names ONE default track, which is what plays without a choice', () => {
    const r = readProbe(
      probe([
        { index: 1, codec_type: 'audio', codec_name: 'aac' },
        { index: 2, codec_type: 'audio', codec_name: 'ac3', disposition: { default: 1 } }
      ])
    )
    expect(r?.audio?.index).toBe(2)
    expect(r?.tracks).toHaveLength(2)
  })

  it('has no tracks at all for a file with no sound', () => {
    const r = readProbe(probe([{ index: 0, codec_type: 'video', codec_name: 'h264' }]))
    expect(r?.tracks).toEqual([])
    expect(r?.audio).toBe(null)
  })
})
