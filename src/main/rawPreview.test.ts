import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { findJpeg, isRaw, rawExtensions, rawPreview } from './rawPreview'
import { findFluid, fluidDirs, isMidi, midiArgs, renderName, resetFluid } from './midi'

/** A JPEG-shaped run of `size` bytes: SOI, filler, EOI. */
function jpeg(size: number, fill = 0x41): Buffer {
  const b = Buffer.alloc(size, fill)
  b[0] = 0xff
  b[1] = 0xd8
  b[2] = 0xff
  b[size - 2] = 0xff
  b[size - 1] = 0xd9
  return b
}

describe('camera raw', () => {
  it('claims the formats the big five cameras write', () => {
    for (const e of ['.cr2', '.cr3', '.nef', '.arw', '.raf', '.orf', '.rw2', '.dng']) {
      expect(isRaw('photo' + e), e).toBe(true)
    }
    expect(rawExtensions().length).toBeGreaterThan(15)
  })

  it('leaves ordinary pictures alone', () => {
    expect(isRaw('photo.jpg')).toBe(false)
    expect(isRaw('photo.png')).toBe(false)
  })

  it('finds an embedded JPEG', () => {
    const file = Buffer.concat([Buffer.alloc(2048, 0x11), jpeg(9000)])
    const found = findJpeg(file)
    expect(found).not.toBeNull()
    expect(found?.length).toBe(9000)
  })

  it('takes the LARGEST, which is the preview and not the thumbnail', () => {
    // Every raw carries a 160px thumbnail as well; showing that would be
    // useless, so size is what decides.
    const file = Buffer.concat([jpeg(5000, 0x22), Buffer.alloc(100), jpeg(60000, 0x33)])
    expect(findJpeg(file)?.length).toBe(60000)
  })

  it('hands back a COPY, so the cached preview does not pin the scan buffer (2026-10-16)', () => {
    const file = Buffer.concat([Buffer.alloc(2048, 0x11), jpeg(9000), Buffer.alloc(50000)])
    const found = findJpeg(file)
    expect(found?.buffer).not.toBe(file.buffer)
    expect(found?.buffer.byteLength).toBe(9000)
    file.fill(0)
    expect(found?.[0]).toBe(0xff) // untouched by the scan buffer's reuse
  })

  it('finds the largest run among several, skipping a start with no end', () => {
    const file = Buffer.concat([
      jpeg(6000, 0x22),
      Buffer.alloc(10),
      jpeg(20000, 0x33),
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(9000, 0x5)
    ])
    expect(findJpeg(file)?.length).toBe(20000)
  })

  it('ignores a fragment too small to be a picture', () => {
    expect(findJpeg(jpeg(200))).toBeNull()
  })

  it('says nothing when there is no JPEG at all', () => {
    expect(findJpeg(Buffer.alloc(50000, 0x7))).toBeNull()
    expect(findJpeg(Buffer.alloc(0))).toBeNull()
  })

  it('does not run off the end of a truncated file', () => {
    // An SOI with no EOI: a real thing in a half-copied file.
    const cut = Buffer.concat([Buffer.alloc(100), Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9000, 0x5)])
    expect(findJpeg(cut)).toBeNull()
  })
})

describe('MIDI', () => {
  it('claims the score formats', () => {
    for (const e of ['song.mid', 'song.midi', 'song.kar', 'song.rmi']) expect(isMidi(e), e).toBe(true)
    expect(isMidi('song.mp3')).toBe(false)
  })

  it('renders quietly to a file, never to a sound device', () => {
    const a = midiArgs('bank.sf3', 'song.mid', 'out.wav')
    expect(a).toContain('-ni') // no shell, no live audio
    expect(a.join(' ')).toContain('-F out.wav')
    expect(a[a.length - 2]).toBe('bank.sf3')
    expect(a[a.length - 1]).toBe('song.mid')
  })

  it('names the rendering stably, and afresh after an edit', () => {
    expect(renderName('a.mid', 1, 2)).toBe(renderName('a.mid', 1, 2))
    expect(renderName('a.mid', 1, 2)).not.toBe(renderName('a.mid', 9, 2))
    expect(renderName('a.mid', 1, 2)).toMatch(/^[0-9a-f]{32}\.wav$/)
  })

  it('looks in resources when packaged, and vendor when not', () => {
    expect(fluidDirs(true, 'C:\\app\\resources', 'C:\\app')[0]).toBe('C:\\app\\resources\\bin')
    expect(fluidDirs(false, '', 'C:\\repo\\out\\main')).toContain('C:\\repo\\vendor\\fluidsynth')
  })
})

describe('read without blocking', () => {
  it('takes the embedded preview out of a raw file on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prism-raw-'))
    const p = join(dir, 'shot.cr2')
    const pic = jpeg(64 * 1024)
    writeFileSync(p, Buffer.concat([Buffer.alloc(512, 1), pic, Buffer.alloc(512, 2)]))
    expect((await rawPreview(p, 1)).equals(pic)).toBe(true)
  })

  it('rejects a raw file that is not there', async () => {
    await expect(rawPreview(join(tmpdir(), 'prism-no-such.cr2'), 1)).rejects.toThrow()
  })

  it('finds the synthesiser only when both halves are there, once', async () => {
    const res = mkdtempSync(join(tmpdir(), 'prism-fluid-'))
    const bin = join(res, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'fluidsynth.exe'), '')
    const app = join(res, 'app')
    resetFluid()
    expect(await findFluid(true, res, app)).toBeNull()
    resetFluid()
    writeFileSync(join(bin, 'soundfont.sf3'), '')
    const one = findFluid(true, res, app)
    expect(findFluid(true, res, app)).toBe(one) // callers share one search
    expect(await one).toEqual({ exe: join(bin, 'fluidsynth.exe'), soundfont: join(bin, 'soundfont.sf3') })
    resetFluid()
  })
})
