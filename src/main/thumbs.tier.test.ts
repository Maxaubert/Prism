import { describe, expect, it } from 'vitest'
import {
  CACHE_MAX_BYTES,
  CACHE_TRIM_BYTES,
  WEBP_MAX_PX,
  inputIsHdr,
  inputNeedsHeifDecoder,
  thumbArgs,
  thumbKey,
  tierFor
} from './thumbs'

// The 640 tier and the desktop's way of making a frame (Stage 2 of the zoom
// grid, 2026-11-09). thumbs.test.ts holds the phone's own rules, unchanged.

describe('the phone is untouched', () => {
  it('a 320 key and a 320 argv are what they always were', () => {
    expect(thumbKey('C:\\a.jpg', 10, 5, 320)).toBe(thumbKey('C:\\a.jpg', 10, 5))
    expect(thumbArgs('C:\\a.jpg', 'image', 'C:\\t\\x.jpg.part', 3, 320)).toEqual([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', 'C:\\a.jpg', '-frames:v', '1',
      '-vf', 'scale=320:-2', '-q:v', '5', '-f', 'image2', 'C:\\t\\x.jpg.part'
    ])
    expect(thumbArgs('C:\\a.mkv', 'video', 'C:\\t\\y.jpg.part')).toEqual([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', '3', '-i', 'C:\\a.mkv', '-frames:v', '1',
      '-vf', 'scale=320:-2', '-q:v', '5', '-f', 'image2', 'C:\\t\\y.jpg.part'
    ])
  })
})

describe('the 640 tier and the desktop (Stage 2 of the zoom grid)', () => {
  it('the 640 tier is its own key, a hex name with the same shape', () => {
    const a = thumbKey('C:\\a.jpg', 10, 5, 320)
    const b = thumbKey('C:\\a.jpg', 10, 5, 640)
    expect(b).not.toBe(a)
    expect(b).toMatch(/^[0-9a-f]{40}\.jpg$/)
    expect(thumbKey('C:\\a.png', 10, 5, 640)).toMatch(/^[0-9a-f]{40}\.webp$/)
  })

  it('a desktop video frame is not the frame the phone is shown, so it has its own key', () => {
    expect(thumbKey('C:\\a.mp4', 10, 5, 320, true)).not.toBe(thumbKey('C:\\a.mp4', 10, 5, 320))
    // A still is the same picture either way: shared with the phone.
    expect(thumbKey('C:\\a.jpg', 10, 5, 320, true)).toBe(thumbKey('C:\\a.jpg', 10, 5, 320))
  })

  it('the width is a parameter, for the still and the clear picture alike', () => {
    const still = thumbArgs('C:\\a.jpg', 'image', 'o.jpg.part', 3, 640)
    expect(still[still.indexOf('-vf') + 1]).toBe('scale=640:-2')
    const png = thumbArgs('C:\\a.png', 'image', 'o.webp.part', 3, 640)
    expect(png[png.indexOf('-vf') + 1]).toBe(`scale=640:-2,crop=iw:'min(ih,${WEBP_MAX_PX})':0:0`)
  })

  it('a desktop video seeks to the nearest keyframe and caps its decode threads', () => {
    const film = thumbArgs('C:\\a.mov', 'video', 'o.jpg.part', 3, 320, { desktop: true })
    expect(film).toContain('-noaccurate_seek')
    expect(film[film.indexOf('-threads') + 1]).toBe('2')
    // Both are input options: they come before -i, after -ss.
    expect(film.indexOf('-ss')).toBeLessThan(film.indexOf('-noaccurate_seek'))
    expect(film.indexOf('-noaccurate_seek')).toBeLessThan(film.indexOf('-i'))
    expect(film.indexOf('-threads')).toBeLessThan(film.indexOf('-i'))
    // The input stream line is read from stderr, so it is not silenced.
    expect(film[film.indexOf('-loglevel') + 1]).toBe('info')
    expect(film).toContain('-nostats')
    // Seek 0 is the first frame: no seek at all.
    const first = thumbArgs('C:\\a.mov', 'video', 'o.jpg.part', 0, 320, { desktop: true })
    expect(first).not.toContain('-ss')
    expect(first).not.toContain('-noaccurate_seek')
  })

  it('a still is not touched by the desktop flag, but a HEIC is read for its stderr', () => {
    const jpg = thumbArgs('C:\\a.jpg', 'image', 'o.jpg.part', 3, 320, { desktop: true })
    expect(jpg).not.toContain('-noaccurate_seek')
    expect(jpg).not.toContain('-threads')
    expect(jpg[jpg.indexOf('-loglevel') + 1]).toBe('error')
    const heic = thumbArgs('C:\\a.heic', 'image', 'o.jpg.part', 3, 320, { desktop: true })
    expect(heic[heic.indexOf('-loglevel') + 1]).toBe('info')
  })

  it('the HDR pass scales first, tone-maps the small frame, and lands as the same JPEG', () => {
    const film = thumbArgs('C:\\a.mov', 'video', 'o.jpg.part', 3, 640, { desktop: true, tonemap: true })
    const vf = film[film.indexOf('-vf') + 1]
    expect(vf.startsWith('scale=640:-2,zscale=t=linear:npl=100')).toBe(true)
    expect(vf).toContain('tonemap=hable:desat=0')
    expect(vf.endsWith('format=yuv420p')).toBe(true)
  })

  it('picks the tier from the tile edge times the device pixel ratio', () => {
    expect(tierFor(160, 2)).toBe(320)
    expect(tierFor(272, 2.25)).toBe(640)
    expect(tierFor(320, 1)).toBe(320)
    expect(tierFor(321, 1)).toBe(640)
    expect(tierFor(100, 0)).toBe(320)
  })

  it('the cache holds 500 MB and trims to 450', () => {
    expect(CACHE_MAX_BYTES).toBe(500 * 1024 * 1024)
    expect(CACHE_TRIM_BYTES).toBe(450 * 1024 * 1024)
  })
})

describe('what ffmpeg says about its input', () => {
  const head = (video: string): string =>
    [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_0001.MOV':",
      '  Duration: 00:00:12.00, start: 0.000000, bitrate: 60000 kb/s',
      `  Stream #0:0[0x1](und): Video: ${video}`,
      '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 98 kb/s',
      'Stream mapping:',
      "Output #0, image2, to 'x.jpg.part':",
      '  Stream #0:0(und): Video: mjpeg, yuvj420p(pc, bt2020nc/bt2020/arib-std-b67, progressive), 640x360'
    ].join('\n')

  it('HLG and PQ are HDR, SDR is not', () => {
    expect(inputIsHdr(head('hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160, 60000 kb/s'))).toBe(true)
    expect(inputIsHdr(head('hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160'))).toBe(true)
    expect(inputIsHdr(head('hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 1920x1080'))).toBe(false)
    expect(inputIsHdr(head('h264 (High), yuv420p(tv, bt709, progressive), 1920x1080'))).toBe(false)
  })

  it('reads only the input: the output line repeats the tags and is not the source', () => {
    const sdr = head('hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 1920x1080')
    expect(sdr).toContain('arib-std-b67')
    expect(inputIsHdr(sdr)).toBe(false)
    expect(inputIsHdr('')).toBe(false)
  })

  it('a HEIC that ffmpeg would show as one tile is sent to the decoder instead', () => {
    const grid = [
      "Input #0, mov, from 'a.heic':",
      '  Stream group #0:0[0x1]: Tile Grid: hevc, 4032x3024',
      '  Stream #0:1[0x2]: Video: hevc (Main), yuvj420p, 512x512'
    ].join('\n')
    expect(inputNeedsHeifDecoder(grid)).toBe(true)
    // A square 512 first stream is how an iPhone's tiles read when the grid is not joined.
    const tile = "Input #0, mov, from 'a.heic':\n  Stream #0:0[0x1]: Video: hevc (Main Still Picture), yuvj420p(pc), 512x512, 1 fps"
    expect(inputNeedsHeifDecoder(tile)).toBe(true)
    const plain = "Input #0, mov, from 'a.heic':\n  Stream #0:0[0x1]: Video: hevc (Main Still Picture), yuvj420p(pc), 640x480, 1 fps"
    expect(inputNeedsHeifDecoder(plain)).toBe(false)
    expect(inputNeedsHeifDecoder('')).toBe(false)
  })
})
