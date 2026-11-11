import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { imageExtensions } from '@shared/fileKind'
import {
  ICON_CONVERTED_MAX,
  ICON_FILE_EXTS,
  ICON_SOURCE_MAX,
  iconFileType,
  isConvertedIcon
} from '@shared/folderIconFiles'
import {
  type IconDecoders,
  listIconFiles,
  pngSize,
  readIconSource,
  readLastIconDir,
  removeUnusedIcons,
  saveIconPng,
  writeLastIconDir
} from './folderIconFiles'

/** A PNG header (signature + IHDR) of this size; enough for the checks. */
function png(width: number, height: number, tail = 0): Uint8Array {
  const b = Buffer.alloc(33 + tail)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  b[24] = 8
  b[25] = 6
  if (tail) b[33] = tail // a different picture, a different hash
  return new Uint8Array(b)
}

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prism-icons-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readIconSource', () => {
  it('reads an accepted picture with its type', async () => {
    const f = join(dir, 'a.PNG')
    writeFileSync(f, Buffer.from(png(10, 10)))
    const r = await readIconSource(f)
    expect('bytes' in r && r.type).toBe('image/png')
    expect('bytes' in r && r.bytes.length).toBe(33)
    // Measured by content: any of the kinds' headers (here a PNG's) passes.
    for (const [ext, type] of [
      ['jpg', 'image/jpeg'],
      ['jpeg', 'image/jpeg'],
      ['gif', 'image/gif'],
      ['bmp', 'image/bmp'],
      ['webp', 'image/webp'],
      ['ico', 'image/x-icon']
    ]) {
      writeFileSync(join(dir, `x.${ext}`), Buffer.from(png(10, 10)))
      const x = await readIconSource(join(dir, `x.${ext}`))
      expect('type' in x && x.type, ext).toBe(type)
    }
    // SVG has no pixels of its own: not measured.
    writeFileSync(join(dir, 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const svg = await readIconSource(join(dir, 'x.svg'))
    expect('type' in svg && svg.type).toBe('image/svg+xml')
  })

  it("Object's own names are not picture kinds (review L1)", async () => {
    for (const ext of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      writeFileSync(join(dir, `x.${ext}`), Buffer.from(png(10, 10)))
      expect(await readIconSource(join(dir, `x.${ext}`)), ext).toEqual({ refused: 'not-picture' })
    }
  })

  it('refuses a picture over 8,192 px a side by its header, before the page decodes it (review M2)', async () => {
    writeFileSync(join(dir, 'wide.png'), Buffer.from(png(40_000, 40_000)))
    expect(await readIconSource(join(dir, 'wide.png'))).toEqual({ refused: 'too-large' })
    writeFileSync(join(dir, 'tall.jpg'), Buffer.from(png(10, 8193)))
    expect(await readIconSource(join(dir, 'tall.jpg'))).toEqual({ refused: 'too-large' })
    writeFileSync(join(dir, 'edge.png'), Buffer.from(png(8192, 8192)))
    expect('bytes' in (await readIconSource(join(dir, 'edge.png')))).toBe(true)
  })

  it('a picture name over bytes that are no picture is refused', async () => {
    writeFileSync(join(dir, 'fake.png'), 'just some words, not a picture at all')
    expect(await readIconSource(join(dir, 'fake.png'))).toEqual({ refused: 'not-picture' })
  })

  it('refuses another kind, a folder, a missing file and one over 16 MB', async () => {
    writeFileSync(join(dir, 'notes.txt'), 'hi')
    expect(await readIconSource(join(dir, 'notes.txt'))).toEqual({ refused: 'not-picture' })
    mkdirSync(join(dir, 'odd.png'))
    expect(await readIconSource(join(dir, 'odd.png'))).toEqual({ refused: 'unreadable' })
    expect(await readIconSource(join(dir, 'gone.png'))).toEqual({ refused: 'unreadable' })
    writeFileSync(join(dir, 'huge.png'), Buffer.alloc(ICON_SOURCE_MAX + 1))
    expect(await readIconSource(join(dir, 'huge.png'))).toEqual({ refused: 'too-big' })
  })
})

describe('more kinds, converted in main (owner, 2026-11-11)', () => {
  /** Decoders that record what they were asked and answer `out`. */
  const stub = (out: Uint8Array = png(200, 100)) => {
    const asked: string[] = []
    const d: IconDecoders = {
      toPng: async (f) => {
        asked.push(`png:${f}`)
        return out
      },
      shrink: async (jpeg) => {
        asked.push(`shrink:${jpeg.length}`)
        return png(256, 128)
      },
      heic: async (f) => {
        asked.push(`heic:${f}`)
        return out
      },
      raw: async (f) => {
        asked.push(`raw:${f}`)
        return out
      }
    }
    return { d, asked }
  }

  it('the dialog offers every still the viewer shows, the page decodes its own kinds as before', () => {
    for (const ext of ['jxl', 'avif', 'heic', 'heif', 'tif', 'tiff', 'psd', 'tga', 'qoi', 'jp2', 'dds', 'exr', 'cr2', 'dng'])
      expect(ICON_FILE_EXTS, ext).toContain(ext)
    for (const ext of ['png', 'jpg', 'jpeg', 'jfif', 'gif', 'bmp', 'webp', 'ico', 'svg']) {
      expect(ICON_FILE_EXTS, ext).toContain(ext)
      expect(isConvertedIcon(ext), ext).toBe(false)
    }
    for (const ext of imageExtensions()) expect(ICON_FILE_EXTS, ext).toContain(ext.slice(1))
    expect(isConvertedIcon('JXL')).toBe(true)
    expect(isConvertedIcon('txt')).toBe(false)
    expect(isConvertedIcon('constructor')).toBe(false)
    expect(iconFileType('jxl')).toBeNull()
    expect(iconFileType('jfif')).toBe('image/jpeg')
    expect(new Set(ICON_FILE_EXTS).size).toBe(ICON_FILE_EXTS.length)
  })

  it('a JPEG XL, TIFF, AVIF, PSD, TGA, QOI goes through ffmpeg and the page gets a PNG', async () => {
    for (const ext of ['jxl', 'tiff', 'tif', 'avif', 'psd', 'tga', 'qoi', 'jp2', 'dds']) {
      const f = join(dir, `x.${ext}`)
      writeFileSync(f, 'whatever ffmpeg reads')
      const { d, asked } = stub()
      const r = await readIconSource(f, d)
      expect(asked, ext).toEqual([`png:${f}`])
      expect('type' in r && r.type, ext).toBe('image/png')
      expect('bytes' in r && r.bytes.length, ext).toBe(33)
    }
  })

  it('a HEIC goes through the HEIC decoder, a camera raw through its preview, then made small', async () => {
    const heic = join(dir, 'p.HEIC')
    const raw = join(dir, 'p.cr2')
    writeFileSync(heic, 'x')
    writeFileSync(raw, 'x')
    const { d, asked } = stub()
    const a = await readIconSource(heic, d)
    const b = await readIconSource(raw, d)
    expect(asked).toEqual([`heic:${heic}`, 'shrink:33', `raw:${raw}`, 'shrink:33'])
    expect('type' in a && a.type).toBe('image/png')
    expect('type' in b && b.type).toBe('image/png')
    // No ffmpeg (or it fails): the JPEG itself.
    const plain = await readIconSource(heic, { ...d, shrink: null })
    expect('type' in plain && plain.type).toBe('image/jpeg')
    const failed = await readIconSource(raw, { ...d, shrink: () => Promise.reject(new Error('no')) })
    expect('type' in failed && failed.type).toBe('image/jpeg')
  })

  it('a high-res camera raw or HEIC over 8,192 px is made small, not refused (review, 2026-11-11)', async () => {
    const raw = join(dir, 'a7r.arw')
    const heic = join(dir, 'big.heic')
    writeFileSync(raw, 'x')
    writeFileSync(heic, 'x')
    // A Sony A7R V's embedded preview, and a 200 MP phone HEIC.
    const { d } = stub(png(9504, 6336))
    for (const f of [raw, heic]) {
      const r = await readIconSource(f, d)
      expect('type' in r && r.type, f).toBe('image/png')
      expect('bytes' in r && pngSize(r.bytes), f).toEqual({ width: 256, height: 128 })
    }
    // Without ffmpeg the page's own check still holds.
    expect(await readIconSource(raw, { ...d, shrink: null })).toEqual({ refused: 'too-large' })
  })

  it('no ffmpeg: refused as no-decoder; a failed convert is not a picture', async () => {
    const f = join(dir, 'x.jxl')
    writeFileSync(f, 'x')
    expect(await readIconSource(f)).toEqual({ refused: 'no-decoder' })
    const fail: IconDecoders = { ...stub().d, toPng: () => Promise.reject(new Error('ffmpeg could not decode')) }
    expect(await readIconSource(f, fail)).toEqual({ refused: 'not-picture' })
  })

  it('the size checks are the converted picture\'s', async () => {
    const f = join(dir, 'x.tiff')
    writeFileSync(f, 'x')
    expect(await readIconSource(f, stub(png(9000, 10)).d)).toEqual({ refused: 'too-large' })
    expect(await readIconSource(f, stub(new Uint8Array(40)).d)).toEqual({ refused: 'not-picture' })
  })

  it('a converted kind may be bigger than 16 MB on disk, up to 256 MB', async () => {
    const f = join(dir, 'scan.tiff')
    writeFileSync(f, Buffer.alloc(ICON_SOURCE_MAX + 1))
    expect('bytes' in (await readIconSource(f, stub().d))).toBe(true)
    // Sparse past the cap: a size, not 256 MB written.
    const big = join(dir, 'vast.tiff')
    const fd = openSync(big, 'w')
    ftruncateSync(fd, ICON_CONVERTED_MAX + 1)
    closeSync(fd)
    const { d, asked } = stub()
    expect(await readIconSource(big, d)).toEqual({ refused: 'too-big' })
    expect(asked).toEqual([])
  })
})

describe('pngSize', () => {
  it('reads the header, and nothing else is a PNG', () => {
    expect(pngSize(png(64, 32))).toEqual({ width: 64, height: 32 })
    expect(pngSize(new Uint8Array(40))).toBeNull()
    expect(pngSize(png(0, 5))).toBeNull()
    const bad = png(5, 5)
    bad[12] = 0x58 // not IHDR
    expect(pngSize(bad)).toBeNull()
  })
})

describe('saveIconPng', () => {
  const icons = (): string => join(dir, 'folder-icons')

  it('keeps a 64 px PNG by its hash, once', async () => {
    const bytes = png(64, 64)
    const r = await saveIconPng(icons(), bytes)
    const hash = createHash('sha256').update(bytes).digest('hex')
    expect(r).toEqual({ id: hash, url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` })
    expect(await saveIconPng(icons(), bytes)).toEqual(r)
    // Written beside it and renamed: no temporary file is left (review L5).
    expect(readdirSync(icons())).toEqual([`${hash}.png`])
  })

  it('saving a copy that is there makes it fresh again (review M3)', async () => {
    const bytes = png(64, 64)
    await saveIconPng(icons(), bytes)
    const id = createHash('sha256').update(bytes).digest('hex')
    const file = join(icons(), `${id}.png`)
    const old = new Date(Date.now() - 5 * 60_000)
    utimesSync(file, old, old)
    await saveIconPng(icons(), bytes)
    expect(Date.now() - statSync(file).mtimeMs).toBeLessThan(30_000)
    // So another window's prune, which cannot name it yet, leaves it.
    expect(await removeUnusedIcons(icons(), [])).toBe(0)
    expect(readdirSync(icons())).toEqual([`${id}.png`])
  })

  it('refuses a PNG over 64 x 64 and what is not a PNG', async () => {
    expect(await saveIconPng(icons(), png(65, 10))).toEqual({ refused: 'not-picture' })
    expect(await saveIconPng(icons(), png(10, 65))).toEqual({ refused: 'not-picture' })
    expect(await saveIconPng(icons(), new TextEncoder().encode('<svg/>'.padEnd(40)))).toEqual({
      refused: 'not-picture'
    })
  })
})

describe('listIconFiles and removeUnusedIcons', () => {
  it('lists the copies as data URLs; a missing folder is none', async () => {
    expect(await listIconFiles(join(dir, 'nope'))).toEqual({ files: {}, complete: true })
    const a = await saveIconPng(dir, png(8, 8))
    writeFileSync(join(dir, 'stray.txt'), 'x')
    const all = await listIconFiles(dir)
    expect(all.complete).toBe(true)
    expect(Object.keys(all.files)).toEqual(['id' in a ? a.id : ''])
    expect(Object.values(all.files)[0]).toMatch(/^data:image\/png;base64,/)
  })

  it('a copy that cannot be read for another reason makes the list incomplete (review M1)', async () => {
    const a = await saveIconPng(dir, png(8, 8))
    // A copy main cannot read (here a folder by that name: EISDIR, as an
    // antivirus scan's EBUSY or EPERM would be).
    mkdirSync(join(dir, `${'e'.repeat(64)}.png`))
    const all = await listIconFiles(dir)
    expect(all.complete).toBe(false)
    expect(Object.keys(all.files)).toEqual(['id' in a ? a.id : ''])
    // A folder that cannot be listed (here a file): incomplete, never "none".
    writeFileSync(join(dir, 'plain'), 'x')
    expect(await listIconFiles(join(dir, 'plain'))).toEqual({ files: {}, complete: false })
  })

  it('removes the copies nobody uses, but not a fresh one or a stranger', async () => {
    const a = await saveIconPng(dir, png(8, 8, 1))
    const b = await saveIconPng(dir, png(8, 8, 2))
    const c = await saveIconPng(dir, png(8, 8, 3))
    const ids = [a, b, c].map((x) => ('id' in x ? x.id : ''))
    writeFileSync(join(dir, 'keep-me.txt'), 'x')
    const old = new Date(Date.now() - 5 * 60_000)
    for (const id of ids.slice(0, 2)) utimesSync(join(dir, `${id}.png`), old, old)
    // a is used, b is old and unused, c is unused but fresh.
    expect(await removeUnusedIcons(dir, [ids[0], '../../evil'])).toBe(1)
    expect(readdirSync(dir).sort()).toEqual([`${ids[0]}.png`, `${ids[2]}.png`, 'keep-me.txt'].sort())
    expect(await removeUnusedIcons(join(dir, 'nope'), [])).toBe(0)
  })

  it('removes a stale half-written copy a crash left, not a fresh one', async () => {
    const stale = `${'a'.repeat(64)}.0123456789ab.tmp`
    const fresh = `${'b'.repeat(64)}.0123456789ab.tmp`
    writeFileSync(join(dir, stale), 'x')
    writeFileSync(join(dir, fresh), 'x')
    const old = new Date(Date.now() - 5 * 60_000)
    utimesSync(join(dir, stale), old, old)
    expect(await removeUnusedIcons(dir, [])).toBe(1)
    expect(readdirSync(dir)).toEqual([fresh])
    // The grace period can be shortened (the e2e does).
    expect(await removeUnusedIcons(dir, [], Date.now() + 1, 0)).toBe(1)
  })
})

describe('the last folder', () => {
  it('starts at Pictures, then is the last pick while that folder is there', async () => {
    const file = join(dir, 'icon-picks.json')
    const pictures = join(dir, 'Pictures')
    expect(await readLastIconDir(file, pictures)).toBe(pictures)
    const picked = join(dir, 'art')
    mkdirSync(picked)
    await writeLastIconDir(file, picked)
    expect(await readLastIconDir(file, pictures)).toBe(picked)
    rmSync(picked, { recursive: true })
    expect(await readLastIconDir(file, pictures)).toBe(pictures)
    writeFileSync(file, '{not json')
    expect(await readLastIconDir(file, pictures)).toBe(pictures)
  })
})
