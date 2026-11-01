import { execFile as nodeExecFile, execFileSync } from 'child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * REAL ENCODES BY THE BUNDLED FFMPEG (#474; review, 2026-11-01: the docs
 * promise an animated GIF or WebP gives its first frame and EXR/HDR are
 * tone-mapped, and only the argv was tested). Each fixture is a few pixels,
 * made by the same ffmpeg; skipped where `vendor/ffmpeg` is not fetched.
 * The process worker is node's own execFile here: the worker thread is
 * main's, and what is tested is what ffmpeg makes of the argv.
 */
vi.mock('./spawnWorker', () => ({ execFile: nodeExecFile }))

const { encodeImage, probeAlpha } = await import('./imageEncode')

const VENDOR = resolve(__dirname, '../../vendor/ffmpeg')
const FFMPEG = join(VENDOR, 'ffmpeg.exe')
const FFPROBE = join(VENDOR, 'ffprobe.exe')
const HAS = existsSync(FFMPEG) && existsSync(FFPROBE)
const TOOLS = { ffmpeg: FFMPEG, ffprobe: FFPROBE }

const ff = (...args: string[]): Buffer => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args], { windowsHide: true })
/** The top-left pixel of `file`'s first frame, as RGB. */
const corner = (file: string): number[] => [
  ...ff('-i', file, '-frames:v', '1', '-vf', 'format=rgb24', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-').subarray(0, 3)
]
/** Red for 0.2 s, then blue: the first frame is red. */
const RED_THEN_BLUE = 'color=c=red:s=32x32:d=0.2:r=10[a];color=c=blue:s=32x32:d=0.2:r=10[b];[a][b]concat=n=2:v=1'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'encode-real-'))
})

describe.skipIf(!HAS)('the copy encoder, for real (#474)', () => {
  it('an animated GIF gives its first frame', async () => {
    const src = join(dir, 'anim.gif')
    ff('-f', 'lavfi', '-i', RED_THEN_BLUE, src)
    const out = join(dir, 'gif.png')
    expect(await encodeImage(TOOLS, src, out, 'png')).toBe(true)
    const [r, g, b] = corner(out)
    expect(r).toBeGreaterThan(200)
    expect(g + b).toBeLessThan(60)
  }, 30000)

  it('an animated WebP gives its first frame', async () => {
    const src = join(dir, 'anim.webp')
    ff('-f', 'lavfi', '-i', RED_THEN_BLUE, '-c:v', 'libwebp_anim', '-loop', '0', src)
    const out = join(dir, 'webp.jpg')
    expect(await encodeImage(TOOLS, src, out, 'jpeg')).toBe(true)
    const [r, g, b] = corner(out)
    expect(r).toBeGreaterThan(200)
    expect(g + b).toBeLessThan(60)
  }, 30000)

  it('an EXR and a Radiance HDR are tone-mapped, not clipped (linear white is not 255)', async () => {
    for (const [ext, codec] of [['exr', 'exr'], ['hdr', 'hdr']] as const) {
      const src = join(dir, `white.${ext}`)
      ff('-f', 'lavfi', '-i', 'color=c=white:s=16x16', '-frames:v', '1', '-vf', 'format=gbrpf32le', '-c:v', codec, src)
      // Untouched, linear 1.0 reads as 255: the tone map is what brings it down.
      expect(corner(src)).toEqual([255, 255, 255])
      const out = join(dir, `${ext}.png`)
      expect(await encodeImage(TOOLS, src, out, 'png')).toBe(true)
      const px = corner(out)
      expect(Math.max(...px), `${ext}: ${px}`).toBeLessThan(200)
      expect(Math.min(...px), `${ext}: ${px}`).toBeGreaterThan(20)
    }
  }, 60000)

  it('probeAlpha: a clear PNG has alpha, an opaque one has none, a missing file is no', async () => {
    const clear = join(dir, 'clear.png')
    const opaque = join(dir, 'opaque.png')
    ff('-f', 'lavfi', '-i', 'color=c=red@0.3:s=8x8', '-frames:v', '1', '-vf', 'format=rgba', clear)
    ff('-f', 'lavfi', '-i', 'color=c=red:s=8x8', '-frames:v', '1', '-vf', 'format=rgb24', opaque)
    expect(await probeAlpha(FFPROBE, clear)).toBe(true)
    expect(await probeAlpha(FFPROBE, opaque)).toBe(false)
    expect(await probeAlpha(FFPROBE, join(dir, 'gone.png'))).toBe(false)
  }, 30000)

  it('an AVIF of an opaque PNG has one picture, of a clear one two (the probe decides)', async () => {
    const clear = join(dir, 'clear2.png')
    const opaque = join(dir, 'opaque2.png')
    ff('-f', 'lavfi', '-i', 'color=c=red@0.3:s=16x16', '-frames:v', '1', '-vf', 'format=rgba', clear)
    ff('-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', '-vf', 'format=rgb24', opaque)
    const streams = (f: string): number =>
      execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=index', '-of', 'csv=p=0', f], { windowsHide: true })
        .toString()
        .trim()
        .split(/\r?\n/).length
    expect(await encodeImage(TOOLS, clear, join(dir, 'clear.avif'), 'avif')).toBe(true)
    expect(await encodeImage(TOOLS, opaque, join(dir, 'opaque.avif'), 'avif')).toBe(true)
    expect(streams(join(dir, 'clear.avif'))).toBe(2)
    expect(streams(join(dir, 'opaque.avif'))).toBe(1)
  }, 60000)

  it('a file ffmpeg cannot read is no copy', async () => {
    const bad = join(dir, 'bad.png')
    writeFileSync(bad, 'not a picture')
    expect(await encodeImage(TOOLS, bad, join(dir, 'bad.jpg'), 'jpeg')).toBe(false)
  }, 30000)
})
