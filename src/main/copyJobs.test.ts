import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The real disk behind Save copies as (#474; review, 2026-11-01: the code
 * that does the disk and encode work had no unit test). The encoder and the
 * decoders are stand-ins; the files are real, in this run's own temp.
 */

const enc = vi.hoisted(() => ({
  encodeImage: vi.fn(),
  heicToJpeg: vi.fn(),
  heicToJpegForCopy: vi.fn(),
  rawPreview: vi.fn(),
  readRawPreview: vi.fn()
}))

vi.mock('./imageEncode', () => ({ encodeImage: enc.encodeImage }))
vi.mock('./heicClient', () => ({
  isHeic: (p: string) => /\.hei[cf]$/i.test(p),
  heicToJpeg: enc.heicToJpeg,
  heicToJpegForCopy: enc.heicToJpegForCopy
}))
vi.mock('./rawPreview', () => ({
  isRaw: (p: string) => /\.(cr2|nef|dng)$/i.test(p),
  rawPreview: enc.rawPreview,
  readRawPreview: enc.readRawPreview
}))

const { cancelCopies, convertForCopy, copiesTemp, dropTemp, endCopies, placeCopy, startCopies, transcodePng } =
  await import('./copyJobs')

const TOOLS = { ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe' }
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])

let dir: string
beforeEach(() => {
  vi.resetAllMocks()
  dir = mkdtempSync(join(tmpdir(), 'copyjobs-'))
  // The encoder writes what it was given as the copy: the input's bytes.
  enc.encodeImage.mockImplementation(async (_t: unknown, input: string, out: string) => {
    writeFileSync(out, readFileSync(input))
    return true
  })
})

describe('convertForCopy (#474)', () => {
  it('no ffmpeg, no copy', async () => {
    expect(await convertForCopy(null, join(dir, 'a.jpg'), join(dir, 'o.png'), 'png', new AbortController().signal)).toBe(false)
    expect(enc.encodeImage).not.toHaveBeenCalled()
  })

  it('a picture ffmpeg reads goes straight to the encoder', async () => {
    const src = join(dir, 'a.jpg')
    writeFileSync(src, JPEG)
    const signal = new AbortController().signal
    expect(await convertForCopy(TOOLS, src, join(dir, 'o.webp'), 'webp', signal)).toBe(true)
    expect(enc.encodeImage).toHaveBeenCalledWith(TOOLS, src, join(dir, 'o.webp'), 'webp', signal)
  })

  it('a HEIC is decoded by the batch decoder, never the viewer\'s (its cache and its queue stay the viewer\'s)', async () => {
    const src = join(dir, 'IMG_0412.HEIC')
    writeFileSync(src, 'heic bytes')
    enc.heicToJpegForCopy.mockResolvedValue(JPEG)
    const out = join(dir, 'o.jxl')
    expect(await convertForCopy(TOOLS, src, out, 'jxl', new AbortController().signal)).toBe(true)
    expect(enc.heicToJpegForCopy).toHaveBeenCalledWith(src)
    expect(enc.heicToJpeg).not.toHaveBeenCalled()
    // The encoder read the decoded JPEG, not the HEIC.
    expect(enc.encodeImage.mock.calls[0][1]).toBe(`${out}.src.jpg`)
    expect(readFileSync(out)).toEqual(JPEG)
  })

  it('the decoded JPEG is gone once its copy is made, made or not (review: 400 HEICs left 1-2 GB in temp)', async () => {
    const src = join(dir, 'b.heic')
    writeFileSync(src, 'heic bytes')
    enc.heicToJpegForCopy.mockResolvedValue(JPEG)
    const out = join(dir, 'o.png')
    await convertForCopy(TOOLS, src, out, 'png', new AbortController().signal)
    expect(existsSync(`${out}.src.jpg`)).toBe(false)
    enc.encodeImage.mockResolvedValueOnce(false)
    expect(await convertForCopy(TOOLS, src, join(dir, 'p.png'), 'png', new AbortController().signal)).toBe(false)
    expect(existsSync(join(dir, 'p.png.src.jpg'))).toBe(false)
  })

  it('a camera RAW gives its own preview, read without the viewer\'s cache', async () => {
    const src = join(dir, 'DSC_1.NEF')
    writeFileSync(src, 'raw bytes')
    enc.readRawPreview.mockResolvedValue(JPEG)
    expect(await convertForCopy(TOOLS, src, join(dir, 'o.avif'), 'avif', new AbortController().signal)).toBe(true)
    expect(enc.readRawPreview).toHaveBeenCalledWith(src)
    expect(enc.rawPreview).not.toHaveBeenCalled()
  })

  it('a HEIC that will not decode is a failed copy, never an encode', async () => {
    const src = join(dir, 'bad.heic')
    writeFileSync(src, 'not really')
    enc.heicToJpegForCopy.mockRejectedValue(new Error('heic decode failed'))
    expect(await convertForCopy(TOOLS, src, join(dir, 'o.png'), 'png', new AbortController().signal)).toBe(false)
    expect(enc.encodeImage).not.toHaveBeenCalled()
  })

  it('a Cancel during the decode starts no encode', async () => {
    const src = join(dir, 'c.heic')
    writeFileSync(src, 'heic bytes')
    const stop = new AbortController()
    enc.heicToJpegForCopy.mockImplementation(async () => {
      stop.abort()
      return JPEG
    })
    expect(await convertForCopy(TOOLS, src, join(dir, 'o.png'), 'png', stop.signal)).toBe(false)
    expect(enc.encodeImage).not.toHaveBeenCalled()
  })
})

describe('placeCopy: never over anything (#474)', () => {
  it('puts the made file at the target and drops the made one', async () => {
    const made = join(dir, 'made.jpg')
    writeFileSync(made, 'copy')
    const target = join(dir, 'a.jpg')
    expect(await placeCopy(made, target)).toBe('ok')
    expect(readFileSync(target, 'utf8')).toBe('copy')
    expect(existsSync(made)).toBe(false)
  })

  it('a taken name is "taken": the file there is untouched, the made one kept for the next name', async () => {
    const made = join(dir, 'made.jpg')
    writeFileSync(made, 'copy')
    const target = join(dir, 'a.jpg')
    writeFileSync(target, 'someone else\'s')
    expect(await placeCopy(made, target)).toBe('taken')
    expect(readFileSync(target, 'utf8')).toBe('someone else\'s')
    expect(existsSync(made)).toBe(true)
  })

  it('a folder that is not there is "failed"', async () => {
    const made = join(dir, 'made.jpg')
    writeFileSync(made, 'copy')
    expect(await placeCopy(made, join(dir, 'no such folder', 'a.jpg'))).toBe('failed')
  })
})

describe('transcodePng: the single save\'s WebP, AVIF and JPEG XL (#474)', () => {
  const jobs = (): string[] => readdirSync(tmpdir()).filter((n) => n.startsWith('prism-copies-'))

  it('hands back the encoded bytes and leaves no job folder', async () => {
    const before = jobs().length
    const png = Buffer.from('png bytes')
    expect(await transcodePng(TOOLS, png, 'webp')).toEqual(png)
    expect(enc.encodeImage.mock.calls[0][3]).toBe('webp')
    expect(jobs()).toHaveLength(before)
  })

  it('an encode that fails, or no ffmpeg, is null', async () => {
    const before = jobs().length
    enc.encodeImage.mockResolvedValueOnce(false)
    expect(await transcodePng(TOOLS, Buffer.from('x'), 'avif')).toBeNull()
    expect(await transcodePng(null, Buffer.from('x'), 'avif')).toBeNull()
    expect(jobs()).toHaveLength(before)
  })

  it('a job folder is made and dropped', async () => {
    const t = await copiesTemp()
    writeFileSync(join(t, 'x'), 'y')
    await dropTemp(t)
    expect(existsSync(t)).toBe(false)
  })
})

describe('Cancel by the chip\'s job id (#474)', () => {
  it('stops the job it names, once, and nothing after it ended', () => {
    const stop = startCopies('copies-1')
    expect(cancelCopies('copies-2')).toBe(false)
    expect(stop.signal.aborted).toBe(false)
    expect(cancelCopies('copies-1')).toBe(true)
    expect(stop.signal.aborted).toBe(true)
    endCopies('copies-1')
    expect(cancelCopies('copies-1')).toBe(false)
  })

  it('a job without an id cannot be cancelled, and still runs', () => {
    const stop = startCopies('')
    expect(cancelCopies('')).toBe(false)
    expect(stop.signal.aborted).toBe(false)
  })
})
