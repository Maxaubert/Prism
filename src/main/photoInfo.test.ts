import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { photoInfo } from './photoInfo'
import { colr, heicWith, iccProfile, jpegWith } from './photoBytes.testkit'

let dir = ''
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'photo-info-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const file = async (name: string, bytes: Buffer): Promise<string> => {
  const p = join(dir, name)
  await writeFile(p, bytes)
  return p
}

describe('photoInfo', () => {
  it('reads the camera and the exposure', async () => {
    const p = await file(
      'cam.jpg',
      jpegWith({
        tags: { make: 'Apple', model: 'iPhone 15 Pro', exposure: [1, 250], fNumber: [18, 10], iso: 64, focal: [24, 1] }
      })
    )
    const info = await photoInfo(p)
    expect(info.camera).toBe('Apple iPhone 15 Pro')
    expect(info.exposure).toBe('1/250s  f/1.8  ISO 64  24mm')
  })

  it('the ICC profile name wins over the EXIF colour space (#78, D8)', async () => {
    const p = await file(
      'p3.jpg',
      jpegWith({ tags: { make: 'Apple', colorSpace: 65535 }, icc: iccProfile('Display P3', 'mluc') })
    )
    expect((await photoInfo(p)).colour).toBe('Display P3')
    const q = await file('srgb-icc.jpg', jpegWith({ tags: { colorSpace: 1 }, icc: iccProfile('Adobe RGB (1998)', 'desc') }))
    expect((await photoInfo(q)).colour).toBe('Adobe RGB (1998)')
  })

  it('EXIF sRGB with no profile still says sRGB; uncalibrated with none says nothing', async () => {
    expect((await photoInfo(await file('srgb.jpg', jpegWith({ tags: { colorSpace: 1 } })))).colour).toBe('sRGB')
    expect((await photoInfo(await file('unc.jpg', jpegWith({ tags: { colorSpace: 65535 } })))).colour).toBeUndefined()
  })

  it('a HEIC takes its colour from its colr/prof box, and none from nclx', async () => {
    const prof = await file('p3.heic', heicWith([colr('prof', iccProfile('Display P3', 'mluc'))]))
    expect((await photoInfo(prof)).colour).toBe('Display P3')
    const nclx = await file('nclx.heic', heicWith([colr('nclx')]))
    expect((await photoInfo(nclx)).colour).toBeUndefined()
  })

  it('a file that is not a photo is an empty answer, not a throw', async () => {
    expect(await photoInfo(await file('x.svg', Buffer.from('<svg/>')))).toEqual({})
  })
})
