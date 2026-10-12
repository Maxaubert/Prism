import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { findFfmpeg, resetFfmpeg } from './ffmpeg'
import {
  mediaPicture,
  mediaProps,
  pictureArgs,
  pictureSource,
  prettyCodec,
  readMediaProps
} from './propsMedia'

// Recorded with the bundled ffprobe (2026-10-12), trimmed to the fields read.
const FLAC_WITH_COVER = {
  streams: [
    {
      index: 0,
      codec_name: 'flac',
      codec_type: 'audio',
      sample_fmt: 's16',
      sample_rate: '44100',
      channels: 2,
      channel_layout: 'stereo',
      bits_per_sample: 0,
      r_frame_rate: '0/0',
      avg_frame_rate: '0/0',
      bits_per_raw_sample: '16',
      disposition: { default: 0, attached_pic: 0 }
    },
    {
      index: 1,
      codec_name: 'png',
      codec_type: 'video',
      width: 320,
      height: 240,
      pix_fmt: 'rgb24',
      r_frame_rate: '90000/1',
      avg_frame_rate: '0/0',
      disposition: { default: 0, attached_pic: 1 },
      tags: { comment: 'Other' }
    }
  ],
  format: {
    duration: '457.000000',
    size: '49807360',
    bit_rate: '871926',
    tags: {
      TITLE: 'Song',
      ARTIST: 'Band',
      ALBUM: 'Rec',
      DATE: '1999-05-01',
      track: '17',
      TRACKTOTAL: '17',
      GENRE: 'Rock'
    }
  }
}

// An mkv: HEVC Main 10, two AAC 5.1 tracks (one titled), an SRT subtitle.
const MKV_WITH_TRACKS = {
  streams: [
    {
      index: 0,
      codec_name: 'hevc',
      profile: 'Main 10',
      codec_type: 'video',
      width: 3840,
      height: 2160,
      pix_fmt: 'yuv420p10le',
      color_transfer: 'smpte2084',
      r_frame_rate: '24000/1001',
      avg_frame_rate: '24000/1001',
      disposition: { default: 1, attached_pic: 0 },
      tags: { DURATION: '00:00:01.001000000' }
    },
    {
      index: 1,
      codec_name: 'aac',
      profile: 'LC',
      codec_type: 'audio',
      sample_fmt: 'fltp',
      sample_rate: '48000',
      channels: 6,
      channel_layout: '5.1',
      bits_per_sample: 0,
      disposition: { default: 1, attached_pic: 0 },
      tags: { language: 'eng' }
    },
    {
      index: 2,
      codec_name: 'truehd',
      codec_type: 'audio',
      sample_rate: '48000',
      channels: 8,
      channel_layout: '7.1',
      bits_per_raw_sample: '24',
      disposition: { default: 0, attached_pic: 0 },
      tags: { language: 'dan', title: 'Commentary' }
    },
    { index: 3, codec_name: 'subrip', codec_type: 'subtitle', tags: { language: 'eng' } },
    {
      index: 4,
      codec_name: 'hdmv_pgs_subtitle',
      codec_type: 'subtitle',
      tags: { language: 'und', title: 'Signs' }
    }
  ],
  format: { duration: '7200.5', bit_rate: '24000000', tags: { ENCODER: 'Lavf63.1.101' } }
}

// A 4K H.264 mp4 from a phone: 8-bit, SDR, AAC stereo, no subtitles.
const PHONE_MP4 = {
  streams: [
    {
      index: 0,
      codec_name: 'h264',
      profile: 'High',
      codec_type: 'video',
      width: 3840,
      height: 2160,
      pix_fmt: 'yuv420p',
      color_transfer: 'bt709',
      bits_per_raw_sample: '8',
      r_frame_rate: '30/1',
      avg_frame_rate: '30000/1001',
      disposition: { default: 1, attached_pic: 0 },
      tags: { language: 'und', handler_name: 'VideoHandle' }
    },
    {
      index: 1,
      codec_name: 'aac',
      profile: 'LC',
      codec_type: 'audio',
      sample_rate: '48000',
      channels: 2,
      channel_layout: 'stereo',
      disposition: { default: 1, attached_pic: 0 },
      tags: { language: 'und', handler_name: 'SoundHandle' }
    }
  ],
  format: { duration: '60.0', bit_rate: '48000000' }
}

describe('readMediaProps', () => {
  it('reads a song: tags, format, the cover', () => {
    expect(readMediaProps(JSON.stringify(FLAC_WITH_COVER))).toEqual({
      duration: 457,
      bitrate: 871926,
      audio: [{ codec: 'FLAC', channels: 2, layout: 'stereo', sampleRate: 44100, bitDepth: 16 }],
      subtitles: [],
      tags: {
        title: 'Song',
        artist: 'Band',
        album: 'Rec',
        year: '1999',
        track: 17,
        trackTotal: 17,
        genre: 'Rock'
      },
      cover: true
    })
  })
  it('reads a film: picture, tracks, subtitles, HDR', () => {
    const got = readMediaProps(MKV_WITH_TRACKS)!
    expect(got.video).toEqual({
      width: 3840,
      height: 2160,
      fps: 23.976,
      codec: 'HEVC (H.265)',
      profile: 'Main 10',
      bitDepth: 10,
      hdr: 'HDR10'
    })
    expect(got.audio).toEqual([
      { codec: 'AAC', language: 'eng', channels: 6, layout: '5.1', sampleRate: 48000 },
      {
        codec: 'TrueHD',
        language: 'dan',
        title: 'Commentary',
        channels: 8,
        layout: '7.1',
        sampleRate: 48000,
        bitDepth: 24
      }
    ])
    expect(got.subtitles).toEqual([
      { language: 'eng', codec: 'SRT' },
      { title: 'Signs', codec: 'PGS' }
    ])
    expect(got.cover).toBe(false)
    expect(got.duration).toBe(7200.5)
  })
  it('reads an SDR H.264 phone video with no language', () => {
    const got = readMediaProps(PHONE_MP4)!
    expect(got.video).toEqual({
      width: 3840,
      height: 2160,
      fps: 29.97,
      codec: 'H.264',
      profile: 'High',
      bitDepth: 8
    })
    expect(got.audio).toEqual([{ codec: 'AAC', channels: 2, layout: 'stereo', sampleRate: 48000 }])
    expect(got.subtitles).toEqual([])
    expect(got.tags).toEqual({})
  })
  it('names HLG and Dolby Vision', () => {
    const v = (extra: object): string | undefined =>
      readMediaProps({ streams: [{ ...MKV_WITH_TRACKS.streams[0], ...extra }] })?.video?.hdr
    expect(v({ color_transfer: 'arib-std-b67' })).toBe('HLG')
    expect(v({ side_data_list: [{ side_data_type: 'DOVI configuration record' }] })).toBe(
      'Dolby Vision'
    )
    expect(v({ color_transfer: 'bt709' })).toBeUndefined()
  })
  it('reads tags in any case and in the forms tracks come in', () => {
    const tags = (t: Record<string, string>): object =>
      readMediaProps({ streams: [FLAC_WITH_COVER.streams[0]], format: { tags: t } })!.tags
    expect(tags({ Track: '3/10', Date: '2004' })).toEqual({
      track: 3,
      trackTotal: 10,
      year: '2004'
    })
    expect(tags({ TRACKNUMBER: '05', TOTALTRACKS: '12' })).toEqual({ track: 5, trackTotal: 12 })
    expect(tags({ album_artist: 'Various' })).toEqual({ artist: 'Various' })
  })
  it('takes an Ogg song tags from its audio stream', () => {
    const got = readMediaProps({
      streams: [
        {
          index: 0,
          codec_name: 'opus',
          codec_type: 'audio',
          channels: 2,
          tags: { TITLE: 'Bird', ARTIST: 'Me' }
        }
      ],
      format: {}
    })!
    expect(got.tags).toEqual({ title: 'Bird', artist: 'Me' })
    // The song's title is not a track name.
    expect(got.audio).toEqual([{ codec: 'Opus', channels: 2 }])
  })
  it('answers null for no JSON and for a file of neither', () => {
    expect(readMediaProps('nope')).toBeNull()
    expect(
      readMediaProps({ streams: [{ index: 0, codec_type: 'subtitle', codec_name: 'srt' }] })
    ).toBeNull()
    // A cover alone is not a film.
    expect(readMediaProps({ streams: [FLAC_WITH_COVER.streams[1]] })).toBeNull()
  })
})

describe('prettyCodec', () => {
  it('names the codecs as people say them', () => {
    expect(
      ['h264', 'hevc', 'av1', 'vp9', 'aac', 'flac', 'truehd', 'eac3', 'ac3', 'opus', 'mp3'].map(
        (c) => prettyCodec(c)
      )
    ).toEqual([
      'H.264',
      'HEVC (H.265)',
      'AV1',
      'VP9',
      'AAC',
      'FLAC',
      'TrueHD',
      'E-AC-3',
      'AC-3',
      'Opus',
      'MP3'
    ])
    expect(prettyCodec('dts', 'DTS-HD MA')).toBe('DTS-HD MA')
    expect(prettyCodec('aac', 'HE-AACv2')).toBe('HE-AACv2')
    expect(prettyCodec('pcm_s24le')).toBe('PCM')
    expect(prettyCodec('weird')).toBe('WEIRD')
  })
})

describe('pictureSource', () => {
  it('takes a film 10% in, else the cover, else nothing', () => {
    expect(pictureSource(MKV_WITH_TRACKS)).toEqual({ stream: 0, at: 720.05 })
    expect(pictureSource(FLAC_WITH_COVER)).toEqual({ stream: 1, at: 0 })
    expect(pictureSource({ streams: [FLAC_WITH_COVER.streams[0]] })).toBeNull()
  })
  it('seeks before the input, maps the one stream and scales to 380 wide', () => {
    const args = pictureArgs('C:\\a.mkv', { stream: 0, at: 12.5 })
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args).toContain('0:0')
    expect(args).toContain('scale=380:-2')
    expect(args.slice(-4)).toEqual(['image2pipe', '-c:v', 'mjpeg', 'pipe:1'])
    expect(pictureArgs('a.flac', { stream: 1, at: 0 })).not.toContain('-ss')
  })
})

// The real thing, with the bundled ffmpeg when this checkout has it.
resetFfmpeg()
const tools = findFfmpeg(false, '', process.cwd())
describe.runIf(!!tools?.ffprobe)('with the bundled ffmpeg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-props-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads a FLAC with a cover and its picture', async () => {
    const cover = join(dir, 'cover.png')
    const song = join(dir, 'song.flac')
    const run = (args: string[]): void => {
      execFileSync(tools!.ffmpeg, ['-v', 'error', '-y', ...args], { timeout: 30_000 })
    }
    run(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=1', '-frames:v', '1', cover])
    run([
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:sample_rate=44100:duration=1',
      '-i',
      cover,
      '-map',
      '0:a',
      '-map',
      '1:v',
      '-c:a',
      'flac',
      '-c:v',
      'png',
      '-disposition:v',
      'attached_pic',
      '-metadata',
      'TITLE=Song',
      '-metadata',
      'TRACKNUMBER=3/10',
      song
    ])
    const props = await mediaProps(tools!.ffprobe!, song)
    expect(props?.cover).toBe(true)
    expect(props?.tags).toMatchObject({ title: 'Song', track: 3, trackTotal: 10 })
    expect(props?.audio[0]).toMatchObject({ codec: 'FLAC', sampleRate: 44100, bitDepth: 16 })
    const picture = await mediaPicture(tools!.ffmpeg, tools!.ffprobe!, song)
    expect(picture?.startsWith('data:image/jpeg;base64,/9j/')).toBe(true)
  }, 60_000)
})
