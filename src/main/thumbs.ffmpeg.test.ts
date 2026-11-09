import { execFile as nodeExecFile, execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * THE DESKTOP'S THUMBNAILS, MADE BY THE REAL BUNDLED FFMPEG (Stage 2 of the
 * zoom grid, 2026-11-09). The argv and the flow are thumbs.tier.test.ts and
 * thumbs.engine.test.ts; what ffmpeg makes of them is here: the orientation of
 * a photo, a clear corner, a HEIC, an iPhone-style HEVC .mov. Skipped where
 * `vendor/ffmpeg` is not fetched. The process worker is node's own execFile.
 */
vi.mock('./spawnWorker', () => ({ execFile: nodeExecFile }))
const { Thumbs } = await import('./thumbs')

const ROOT = resolve(__dirname, '../..')
const FFMPEG = join(ROOT, 'vendor/ffmpeg/ffmpeg.exe')
const HAS = existsSync(FFMPEG)
const HEIC = join(ROOT, 'tools/e2e/assets/gradient.heic')
const HEVC = join(ROOT, '.e2e/fixtures/av/iphone-hevc.mov')

const ff = (...args: string[]): Buffer => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args], { windowsHide: true })
/** Width and height of a picture, as ffmpeg reads it. */
function sizeOf(file: string): { w: number; h: number } {
  const r = (() => {
    try {
      execFileSync(FFMPEG, ['-hide_banner', '-i', file], { windowsHide: true, stdio: 'pipe' })
      return ''
    } catch (e) {
      return String((e as { stderr?: Buffer }).stderr ?? '')
    }
  })()
  const m = /Video: [^\n]*?(\d{2,5})x(\d{2,5})/.exec(r)
  return { w: Number(m?.[1]), h: Number(m?.[2]) }
}
/** The mean of a picture's grey value, 0 to 255. */
function brightness(file: string): number {
  const raw = ff('-i', file, '-frames:v', '1', '-vf', 'scale=16:16,format=gray', '-f', 'rawvideo', '-')
  return raw.reduce((n, v) => n + v, 0) / raw.length
}
/** A JPEG with an EXIF orientation of 6 (rotate 90 clockwise to show it). */
function withOrientation6(jpeg: Buffer): Buffer {
  const tiff = Buffer.from('4d4d002a00000008' + '0001' + '011200030000000100060000' + '00000000', 'hex')
  const body = Buffer.concat([Buffer.from('Exif\0\0'), tiff])
  const len = Buffer.alloc(2)
  len.writeUInt16BE(body.length + 2)
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), len, body, jpeg.subarray(2)])
}

let dir: string
let thumbs: InstanceType<typeof Thumbs>
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'thumbs-real-'))
  thumbs = new Thumbs(FFMPEG, join(dir, 'cache'))
})

describe.skipIf(!HAS)('the desktop thumbnail, for real', () => {
  it('applies a photo\'s EXIF orientation: a 64x32 photo turned to portrait is 320 wide and 640 tall', async () => {
    const base = join(dir, 'base.jpg')
    ff('-f', 'lavfi', '-i', 'testsrc=size=64x32:rate=1', '-frames:v', '1', base)
    const turned = join(dir, 'turned.jpg')
    writeFileSync(turned, withOrientation6(readFileSync(base)))
    const out = await thumbs.makeFor(turned, 'image', 320)
    expect(out).not.toBeNull()
    expect(sizeOf(out as string)).toEqual({ w: 320, h: 640 })
    // The plain one is landscape.
    const plain = await thumbs.makeFor(base, 'image', 320)
    expect(sizeOf(plain as string)).toEqual({ w: 320, h: 160 })
  }, 30000)

  it('the 640 tier is 640 wide and a different file than the 320', async () => {
    const f = join(dir, 'base.jpg')
    const small = await thumbs.makeFor(f, 'image', 320)
    const big = await thumbs.makeFor(f, 'image', 640)
    expect(big).not.toBe(small)
    expect(sizeOf(big as string).w).toBe(640)
  }, 30000)

  it('keeps the clear corner of a PNG as a WebP', async () => {
    const png = join(dir, 'clear.png')
    ff('-f', 'lavfi', '-i', 'color=c=red@0.0:s=32x32,format=rgba', '-frames:v', '1', png)
    const out = await thumbs.makeFor(png, 'image', 320)
    expect(out).toMatch(/\.webp$/)
    const px = ff('-i', out as string, '-frames:v', '1', '-vf', 'format=rgba', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-').subarray(0, 4)
    expect(px[3]).toBe(0)
  }, 30000)

  it('a zero-byte jpg and a text file named .jpg are no picture, and are not retried', async () => {
    const empty = join(dir, 'empty.jpg')
    writeFileSync(empty, '')
    const fake = join(dir, 'fake.jpg')
    writeFileSync(fake, 'this is not a picture')
    expect(await thumbs.makeFor(empty, 'image', 320)).toBeNull()
    expect(await thumbs.makeFor(fake, 'image', 320)).toBeNull()
    const runs = thumbs.stats().runs
    expect(await thumbs.makeFor(fake, 'image', 320)).toBeNull()
    expect(thumbs.stats().runs).toBe(runs)
  }, 30000)

  it.skipIf(!existsSync(HEIC))('a HEIC goes through ffmpeg alone (the route chosen by measurement)', async () => {
    const heic = vi.fn(async () => Buffer.alloc(0))
    const t = new Thumbs(FFMPEG, join(dir, 'cache-heic'), undefined, { heic })
    const f = join(dir, 'g.heic')
    copyFileSync(HEIC, f)
    const out = await t.makeFor(f, 'image', 320)
    expect(out).not.toBeNull()
    expect(heic).not.toHaveBeenCalled()
    expect(sizeOf(out as string)).toEqual({ w: 320, h: 240 })
    expect(brightness(out as string)).toBeGreaterThan(20)
  }, 30000)

  it.skipIf(!existsSync(HEVC))('an iPhone-style HEVC .mov gives a frame that is not black', async () => {
    const f = join(dir, 'clip.mov')
    copyFileSync(HEVC, f)
    const out = await thumbs.makeFor(f, 'video', 320)
    expect(out).not.toBeNull()
    expect(sizeOf(out as string).w).toBe(320)
    expect(brightness(out as string)).toBeGreaterThan(8)
  }, 30000)
})
