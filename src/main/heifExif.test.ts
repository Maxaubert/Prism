import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { heifIccProfile } from './heifExif'
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
