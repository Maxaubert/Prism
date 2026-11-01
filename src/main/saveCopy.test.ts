import { describe, expect, it, vi } from 'vitest'
import { copyDefaultPath, saveImageCopy, type SaveCopyDeps } from './saveCopy'

const bytes = (): ArrayBuffer => new Uint8Array([1, 2, 3]).buffer

const deps = (answer: { canceled: boolean; filePath?: string }, write = vi.fn(() => Promise.resolve())): SaveCopyDeps & {
  ask: ReturnType<typeof vi.fn>
  write: typeof write
  written: ReturnType<typeof vi.fn>
} => ({
  ask: vi.fn(() => Promise.resolve(answer)),
  write,
  written: vi.fn(() => Promise.resolve())
})

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
})
