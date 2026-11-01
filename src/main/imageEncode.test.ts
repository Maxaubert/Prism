import { describe, expect, it } from 'vitest'
import { alphaPixFmt, encodeArgs, mayCarryAlpha } from './imageEncode'

const after = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

describe('the copy encoder argv (#474)', () => {
  it('every format: one frame, no metadata, the EXIF side data dropped, to the named file', () => {
    for (const f of ['jpeg', 'png', 'webp', 'avif', 'jxl'] as const) {
      const a = encodeArgs('C:\\p\\in.jpg', 'C:\\t\\out', f, { alpha: false, hdr: false })
      expect(a.slice(0, 4)).toEqual(['-hide_banner', '-loglevel', 'error', '-nostdin'])
      expect(after(a, '-i')).toBe('C:\\p\\in.jpg')
      expect(after(a, '-frames:v')).toBe('1') // an animated GIF or WebP: the first frame
      expect(after(a, '-map_metadata')).toBe('-1')
      // AV_FRAME_DATA_EXIF is 31 in the bundled ffmpeg 9, which lists no name
      // for it; without this a PNG and a JPEG XL carried the camera's EXIF
      // (MEASURED 2026-11-01: the maker's name was in the PNG).
      expect(a.join(' ')).toContain('sidedata=mode=delete:type=31')
      expect(a[a.length - 1]).toBe('C:\\t\\out')
    }
  })

  it('the quality each format is made at', () => {
    const jpeg = encodeArgs('in.png', 'o', 'jpeg', { alpha: false, hdr: false })
    expect([after(jpeg, '-c:v'), after(jpeg, '-q:v'), after(jpeg, '-qmin')]).toEqual(['mjpeg', '1', '1'])
    const png = encodeArgs('in.png', 'o', 'png', { alpha: false, hdr: false })
    expect(after(png, '-c:v')).toBe('png')
    const webp = encodeArgs('in.png', 'o', 'webp', { alpha: false, hdr: false })
    expect([after(webp, '-c:v'), after(webp, '-quality'), after(webp, '-f')]).toEqual(['libwebp', '90', 'webp'])
    const avif = encodeArgs('in.png', 'o', 'avif', { alpha: false, hdr: false })
    expect([after(avif, '-c:v'), after(avif, '-crf'), after(avif, '-still-picture'), after(avif, '-f')]).toEqual([
      'libaom-av1',
      '18',
      '1',
      'avif'
    ])
    const jxl = encodeArgs('in.png', 'o', 'jxl', { alpha: false, hdr: false })
    expect([after(jxl, '-c:v'), after(jxl, '-distance')]).toEqual(['libjxl', '1'])
  })

  it('JPEG has no alpha, so a clear picture goes onto white, as the single save does', () => {
    const a = encodeArgs('in.png', 'o', 'jpeg', { alpha: true, hdr: false })
    const graph = after(a, '-filter_complex') ?? ''
    expect(graph).toContain('drawbox=c=white:replace=1:t=fill')
    expect(graph).toContain('overlay')
    expect(a).toContain('-map')
    // An opaque picture needs no ground.
    expect(encodeArgs('in.jpg', 'o', 'jpeg', { alpha: false, hdr: false })).not.toContain('-filter_complex')
  })

  it('AVIF keeps alpha as a second picture; PNG, WebP and JPEG XL keep it on their own', () => {
    const a = encodeArgs('in.png', 'o', 'avif', { alpha: true, hdr: false })
    const graph = after(a, '-filter_complex') ?? ''
    expect(graph).toContain('alphaextract')
    // MEASURED: libaom refuses a grey plane tagged RGB ("Subsampling must be 0").
    expect(graph).toContain('setparams=colorspace=bt709:range=pc')
    expect(a.filter((x) => x === '-map')).toHaveLength(2)
    for (const f of ['png', 'webp', 'jxl'] as const)
      expect(encodeArgs('in.png', 'o', f, { alpha: true, hdr: false })).not.toContain('-filter_complex')
  })

  it('EXR and HDR are tone-mapped first, as the viewer does', () => {
    const a = encodeArgs('in.exr', 'o', 'png', { alpha: false, hdr: true })
    expect(after(a, '-vf')).toMatch(/^format=gbrpf32le,tonemap=hable/)
  })

  it('which sources can carry alpha, and which pixel formats do', () => {
    for (const e of ['.png', '.webp', '.gif', '.tif', '.psd', '.avif', '.jxl', '.tga']) expect(mayCarryAlpha(e)).toBe(true)
    for (const e of ['.jpg', '.jpeg', '.heic', '.cr2', '.jfif']) expect(mayCarryAlpha(e)).toBe(false)
    for (const p of ['rgba', 'ya8', 'yuva420p', 'pal8', 'rgba64be', 'gbrap', 'bgra']) expect(alphaPixFmt(p)).toBe(true)
    for (const p of ['rgb24', 'yuv420p', 'gray', 'yuvj444p', 'rgb48be', '']) expect(alphaPixFmt(p)).toBe(false)
  })
})
