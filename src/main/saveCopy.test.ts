import { describe, expect, it, vi } from 'vitest'
import { copyDefaultPath, isPrismTempCopy, saveImageCopy, type SaveCopyDeps } from './saveCopy'

const bytes = (): ArrayBuffer => new Uint8Array([1, 2, 3]).buffer

const deps = (answer: { canceled: boolean; filePath?: string }, write = vi.fn(() => Promise.resolve())): SaveCopyDeps & {
  ask: ReturnType<typeof vi.fn>
  write: typeof write
  written: ReturnType<typeof vi.fn>
} => ({
  ask: vi.fn(() => Promise.resolve(answer)),
  write,
  written: vi.fn(() => Promise.resolve()),
  temp: TEMP
})

const TEMP = 'C:\\Users\\me\\AppData\\Local\\Temp'
const MEMBER = `${TEMP}\\prism-members\\4242-1700000000000\\0123abcd\\IMG_0412.jpg`

describe('Save a copy (#78)', () => {
  it('opens in the photo\'s own folder with its name and the new extension', () => {
    expect(copyDefaultPath('IMG_0412.HEIC', 'jpeg', 'C:\\pics\\IMG_0412.HEIC')).toBe('C:\\pics\\IMG_0412.jpg')
    // The same format would land on the photo itself, which is refused: "copy" goes on the name.
    expect(copyDefaultPath('a.b.png', 'png', 'D:\\x\\a.b.png')).toBe('D:\\x\\a.b copy.png')
    expect(copyDefaultPath('a.JPG', 'jpeg', 'D:\\x\\a.JPG')).toBe('D:\\x\\a copy.jpg')
    // No source (a picture with no file of its own): the name alone, as before.
    expect(copyDefaultPath('page 3.webp', 'png')).toBe('page 3.png')
  })

  it('saves where the dialog says, and names it', async () => {
    const d = deps({ canceled: false, filePath: 'C:\\out\\IMG_0412.jpg' })
    const r = await saveImageCopy({ bytes: bytes(), suggested: 'IMG_0412.HEIC', format: 'jpeg', source: 'C:\\pics\\IMG_0412.HEIC' }, d)
    expect(r).toEqual({ saved: 'C:\\out\\IMG_0412.jpg' })
    expect(d.ask).toHaveBeenCalledWith({
      defaultPath: 'C:\\pics\\IMG_0412.jpg',
      filters: [{ name: 'JPEG image', extensions: ['jpg'] }]
    })
    expect(d.write).toHaveBeenCalledTimes(1)
    expect(d.written).toHaveBeenCalledWith('C:\\out\\IMG_0412.jpg')
  })

  it('a cancel is a cancel, and writes nothing', async () => {
    const d = deps({ canceled: true })
    expect(await saveImageCopy({ bytes: bytes(), suggested: 'a.png', format: 'png' }, d)).toEqual({ canceled: true })
    expect(d.write).not.toHaveBeenCalled()
  })

  it('a write that fails says so', async () => {
    const d = deps({ canceled: false, filePath: 'C:\\locked\\a.png' }, vi.fn(() => Promise.reject(new Error('EPERM'))))
    expect(await saveImageCopy({ bytes: bytes(), suggested: 'a.png', format: 'png' }, d)).toEqual({ failed: true })
    expect(d.written).not.toHaveBeenCalled()
  })

  it('never saves over the photo being viewed', async () => {
    const d = deps({ canceled: false, filePath: 'c:\\PICS\\a.png' })
    const r = await saveImageCopy({ bytes: bytes(), suggested: 'a.png', format: 'png', source: 'C:\\pics\\a.png' }, d)
    expect(r).toEqual({ failed: true, reason: 'source' })
    expect(d.write).not.toHaveBeenCalled()
  })

  it('no bytes is a failure without a dialog', async () => {
    const d = deps({ canceled: false, filePath: 'C:\\a.png' })
    expect(await saveImageCopy({ bytes: new ArrayBuffer(0), suggested: 'a.png', format: 'png' }, d)).toEqual({ failed: true })
    expect(d.ask).not.toHaveBeenCalled()
  })

  // Review, 2026-11-01: a member of a zip browsed as a folder (#300) is shown
  // from its unpacked copy in Prism's temp folder, which is removed at quit.
  // A copy saved beside it was lost, so the dialog does not open there.
  it('a temp copy (a zip member) is not where the dialog opens', async () => {
    expect(isPrismTempCopy(MEMBER, TEMP)).toBe(true)
    expect(isPrismTempCopy(`${TEMP}\\prism-zip-ab12\\a.png`, TEMP)).toBe(true)
    expect(isPrismTempCopy(`${TEMP.toLowerCase()}\\PRISM-ARC-x\\a.png`, TEMP)).toBe(true)
    // Someone's own file in Temp, or a folder merely named like ours elsewhere, is theirs.
    expect(isPrismTempCopy(`${TEMP}\\holiday\\a.png`, TEMP)).toBe(false)
    expect(isPrismTempCopy(`${TEMP}\\a.png`, TEMP)).toBe(false)
    expect(isPrismTempCopy('D:\\prism-members\\a.png', TEMP)).toBe(false)
    const d = deps({ canceled: false, filePath: 'C:\\out\\IMG_0412.png' })
    const r = await saveImageCopy({ bytes: bytes(), suggested: 'IMG_0412.jpg', format: 'png', source: MEMBER }, d)
    expect(r).toEqual({ saved: 'C:\\out\\IMG_0412.png' })
    expect(d.ask).toHaveBeenCalledWith({ defaultPath: 'IMG_0412.png', filters: [{ name: 'PNG image', extensions: ['png'] }] })
  })

  it('the temp copy itself is still refused as a target', async () => {
    const d = deps({ canceled: false, filePath: MEMBER })
    const r = await saveImageCopy({ bytes: bytes(), suggested: 'IMG_0412.jpg', format: 'jpeg', source: MEMBER }, d)
    expect(r).toEqual({ failed: true, reason: 'source' })
    expect(d.write).not.toHaveBeenCalled()
  })

  // #474 (owner, 2026-11-01): the single save offers the batch's five formats.
  // WebP, AVIF and JPEG XL arrive as the canvas's PNG and main encodes them.
  it('WebP, AVIF and JPEG XL are made in main from the PNG, and land under their own extension', async () => {
    for (const [format, ext, name] of [
      ['webp', 'webp', 'WebP image'],
      ['avif', 'avif', 'AVIF image'],
      ['jxl', 'jxl', 'JPEG XL image']
    ] as const) {
      const made = Buffer.from([9, 9])
      const transcode = vi.fn(() => Promise.resolve(made))
      const d = { ...deps({ canceled: false, filePath: `C:\\out\\a.${ext}` }), transcode }
      const r = await saveImageCopy({ bytes: bytes(), suggested: 'a.HEIC', format, source: 'C:\\p\\a.HEIC' }, d)
      expect(r).toEqual({ saved: `C:\\out\\a.${ext}` })
      expect(d.ask).toHaveBeenCalledWith({ defaultPath: `C:\\p\\a.${ext}`, filters: [{ name, extensions: [ext] }] })
      expect(transcode).toHaveBeenCalledWith(Buffer.from(bytes()), format)
      expect(d.write).toHaveBeenCalledWith(`C:\\out\\a.${ext}`, made)
    }
  })

  it('JPEG and PNG are written as the canvas made them', async () => {
    const transcode = vi.fn(() => Promise.resolve(Buffer.from([1])))
    const d = { ...deps({ canceled: false, filePath: 'C:\\out\\a.jpg' }), transcode }
    await saveImageCopy({ bytes: bytes(), suggested: 'a.png', format: 'jpeg' }, d)
    expect(transcode).not.toHaveBeenCalled()
  })

  it('an encode that fails says so, and writes nothing', async () => {
    const d = { ...deps({ canceled: false, filePath: 'C:\\out\\a.avif' }), transcode: vi.fn(() => Promise.resolve(null)) }
    expect(await saveImageCopy({ bytes: bytes(), suggested: 'a.png', format: 'avif' }, d)).toEqual({ failed: true })
    expect(d.write).not.toHaveBeenCalled()
  })

  it('the same format as the photo is "name copy.ext" for the new formats too', () => {
    expect(copyDefaultPath('a.webp', 'webp', 'D:\\x\\a.webp')).toBe('D:\\x\\a copy.webp')
    expect(copyDefaultPath('a.JXL', 'jxl', 'D:\\x\\a.JXL')).toBe('D:\\x\\a copy.jxl')
  })
})
