import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { heifExifBlock, heifIccProfile } from './heifExif'
import { colr, heicWith, iccProfile } from './photoBytes.testkit'

let dir = ''
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'heif-icc-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const heic = async (name: string, bytes: Buffer): Promise<string> => {
  const p = join(dir, name)
  await writeFile(p, bytes)
  return p
}

describe('heifIccProfile (#78, D8)', () => {
  it('finds the ICC profile in a colr/prof box', async () => {
    const icc = iccProfile('Display P3', 'mluc')
    const got = await heifIccProfile(await heic('p3.heic', heicWith([colr('prof', icc)])))
    expect(got?.equals(icc)).toBe(true)
  })

  it('ignores an nclx box, and takes a prof that comes after one', async () => {
    expect(await heifIccProfile(await heic('nclx.heic', heicWith([colr('nclx')])))).toBeNull()
    const icc = iccProfile('Display P3', 'desc')
    const got = await heifIccProfile(await heic('both.heic', heicWith([colr('nclx'), colr('prof', icc)])))
    expect(got?.equals(icc)).toBe(true)
  })

  it('answers null for a file with no meta box, or no file', async () => {
    expect(await heifIccProfile(await heic('junk.heic', Buffer.from('not a heic at all')))).toBeNull()
    expect(await heifIccProfile(join(dir, 'missing.heic'))).toBeNull()
  })
})

describe('heifExifBlock refuses boxes that claim a huge size (audit #78)', () => {
  const box = (kind: string, size: number, body = Buffer.alloc(0)): Buffer => {
    const h = Buffer.alloc(8)
    h.writeUInt32BE(size, 0)
    h.write(kind, 4, 'latin1')
    return Buffer.concat([h, body])
  }
  it('answers null without allocating the claimed size', async () => {
    const iloc = box('iloc', 16, Buffer.alloc(8))
    const iinf = box('iinf', 0x7ffffff0)
    const inner = Buffer.concat([Buffer.alloc(4), iloc, iinf])
    const file = await heic('huge.heic', Buffer.concat([box('ftyp', 16, Buffer.alloc(8)), box('meta', 8 + inner.length, inner)]))
    const spy = vi.spyOn(Buffer, 'alloc')
    try {
      expect(await heifExifBlock(file)).toBeNull()
      expect(spy.mock.calls.every(([n]) => n < 1 << 20)).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})