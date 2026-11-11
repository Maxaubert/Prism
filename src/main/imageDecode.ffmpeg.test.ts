import { execFile as nodeExecFile, execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { pngSize } from '@shared/pictureSize'

/**
 * FOLDER ICONS FROM MORE KINDS, FOR REAL (owner, 2026-11-11). The bundled
 * ffmpeg turns a JPEG XL, TIFF, AVIF, QOI and TGA into a PNG of at most 256 px
 * a side, alpha kept, never made bigger. Fixtures are made by the same
 * ffmpeg; skipped where `vendor/ffmpeg` is not fetched. The process worker is
 * node's own execFile here, as in imageEncode.ffmpeg.test.ts.
 */
vi.mock('./spawnWorker', () => ({ execFile: nodeExecFile }))

const { decodeIconPng, iconArgs, shrinkIconPng } = await import('./imageDecode')

const VENDOR = resolve(__dirname, '../../vendor/ffmpeg')
const FFMPEG = join(VENDOR, 'ffmpeg.exe')
const HAS = existsSync(FFMPEG)

const ff = (...args: string[]): Buffer => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args], { windowsHide: true })
/** The top-left pixel of a PNG's first frame, as RGBA. */
const corner = (file: string): number[] => [
  ...ff('-i', file, '-frames:v', '1', '-vf', 'crop=1:1:0:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-').subarray(0, 4)
]

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'icon-decode-'))
})

describe('the icon argv', () => {
  it('scales in ffmpeg to at most the size, keeps aspect and alpha, one frame of PNG', () => {
    const a = iconArgs('C:\\p\\scan.tiff', 256)
    expect(a.slice(a.indexOf('-i'), a.indexOf('-i') + 2)).toEqual(['-i', 'C:\\p\\scan.tiff'])
    const vf = a[a.indexOf('-vf') + 1]
    expect(vf).toContain("scale=w='if(gte(iw,ih),min(256,iw),max(1,round(min(256,ih)*iw/ih)))'")
    expect(vf).toContain(":h='if(gte(iw,ih),max(1,round(min(256,iw)*ih/iw)),min(256,ih))'")
    expect(vf.endsWith('format=rgba')).toBe(true)
    expect(vf).not.toContain('tonemap')
    expect(a).toEqual(expect.arrayContaining(['-frames:v', '1', '-pix_fmt', 'rgba', '-c:v', 'png', 'pipe:1']))
    expect(iconArgs('x.exr', 256)[iconArgs('x.exr', 256).indexOf('-vf') + 1]).toContain('tonemap=hable')
  })
})

describe.skipIf(!HAS)('icons through the bundled ffmpeg, for real (2026-11-11)', () => {
  it('a big half-clear TIFF becomes a 256 x 128 PNG with its alpha', async () => {
    const src = join(dir, 'big.tiff')
    // The alpha is made inside the source graph (a later -vf sees it gone).
    ff('-f', 'lavfi', '-i', 'color=c=red@0.5:s=1000x500,format=rgba', '-frames:v', '1', src)
    expect(corner(src)[3]).toBe(127)
    const png = await decodeIconPng(FFMPEG, src, 256)
    expect(pngSize(png)).toEqual({ width: 256, height: 128 })
    const out = join(dir, 'big.png')
    writeFileSync(out, png)
    const [r, , , alpha] = corner(out)
    expect(r).toBeGreaterThan(200)
    expect(alpha).toBeGreaterThan(100)
    expect(alpha).toBeLessThan(160)
  }, 30000)

  it('a small JPEG XL is never made bigger', async () => {
    const src = join(dir, 'small.jxl')
    ff('-f', 'lavfi', '-i', 'color=c=blue:s=40x20', '-frames:v', '1', src)
    expect(pngSize(await decodeIconPng(FFMPEG, src, 256))).toEqual({ width: 40, height: 20 })
  }, 30000)

  it('an AVIF, a QOI and a TGA each give a PNG', async () => {
    for (const [ext, extra] of [
      ['avif', ['-c:v', 'libaom-av1', '-still-picture', '1']],
      ['qoi', []],
      ['tga', []]
    ] as const) {
      const src = join(dir, `x.${ext}`)
      ff('-f', 'lavfi', '-i', 'color=c=green:s=600x300', '-frames:v', '1', ...extra, src)
      expect(pngSize(await decodeIconPng(FFMPEG, src, 256)), ext).toEqual({ width: 256, height: 128 })
    }
  }, 60000)

  it('a very thin strip keeps at least 1 px (review: 4000 x 4 was "256x0", refused)', async () => {
    const wide = join(dir, 'strip.tiff')
    ff('-f', 'lavfi', '-i', 'color=c=red:s=4000x4', '-frames:v', '1', wide)
    expect(pngSize(await decodeIconPng(FFMPEG, wide, 256))).toEqual({ width: 256, height: 1 })
    const tall = join(dir, 'pole.tga')
    ff('-f', 'lavfi', '-i', 'color=c=red:s=4x4000', '-frames:v', '1', tall)
    expect(pngSize(await decodeIconPng(FFMPEG, tall, 256))).toEqual({ width: 1, height: 256 })
  }, 30000)

  it('a JPEG over 8,192 px that main holds (a raw preview, a HEIC) becomes a small PNG', async () => {
    const src = join(dir, 'a7r.jpg')
    ff('-f', 'lavfi', '-i', 'color=c=blue:s=9504x6336', '-frames:v', '1', src)
    const png = await shrinkIconPng(FFMPEG, readFileSync(src), 256)
    expect(pngSize(png)).toEqual({ width: 256, height: 171 })
  }, 30000)

  it('a file ffmpeg cannot read is refused', async () => {
    const bad = join(dir, 'bad.jxl')
    writeFileSync(bad, 'not a picture')
    await expect(decodeIconPng(FFMPEG, bad, 256)).rejects.toThrow()
  }, 30000)
})
