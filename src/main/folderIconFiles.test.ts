import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ICON_SOURCE_MAX } from '@shared/folderIconFiles'
import {
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
    for (const [ext, type] of [
      ['jpg', 'image/jpeg'],
      ['jpeg', 'image/jpeg'],
      ['gif', 'image/gif'],
      ['bmp', 'image/bmp'],
      ['webp', 'image/webp'],
      ['ico', 'image/x-icon'],
      ['svg', 'image/svg+xml']
    ]) {
      writeFileSync(join(dir, `x.${ext}`), 'x')
      const x = await readIconSource(join(dir, `x.${ext}`))
      expect('type' in x && x.type, ext).toBe(type)
    }
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
    expect(readdirSync(icons())).toEqual([`${hash}.png`])
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
    expect(await listIconFiles(join(dir, 'nope'))).toEqual({})
    const a = await saveIconPng(dir, png(8, 8))
    writeFileSync(join(dir, 'stray.txt'), 'x')
    const all = await listIconFiles(dir)
    expect(Object.keys(all)).toEqual(['id' in a ? a.id : ''])
    expect(Object.values(all)[0]).toMatch(/^data:image\/png;base64,/)
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
