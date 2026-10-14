import { beforeEach, describe, expect, it } from 'vitest'
import { fakeCopyFiles, fakeFiles, fakeFormats, installFakeClipboard, resetFakeClipboard } from './e2eClipboard'

const img = (png: Buffer) => ({ toPNG: () => png, isEmpty: () => png.length === 0 })

describe('the e2e clipboard (#356)', () => {
  let cb: Record<string, (...a: unknown[]) => unknown>
  beforeEach(() => {
    resetFakeClipboard()
    cb = { readText: () => 'REAL', writeText: () => {} }
    installFakeClipboard(cb as Record<string, unknown>, img)
  })

  it('replaces the methods, so nothing reaches the real one', () => {
    expect(cb.readText()).toBe('')
    cb.writeText('fixture paths')
    expect(cb.readText()).toBe('fixture paths')
  })

  it('a write replaces what was there, as the real clipboard does', () => {
    cb.writeText('a')
    cb.writeImage(img(Buffer.from([1, 2, 3])))
    expect(cb.readText()).toBe('')
    expect(fakeFormats()).toEqual(['image/png'])
    expect((cb.readImage() as { toPNG(): Buffer }).toPNG()).toEqual(Buffer.from([1, 2, 3]))
    cb.clear()
    expect(fakeFormats()).toEqual([])
  })

  it('holds a file copy, with its text for Copy address', () => {
    fakeCopyFiles(['C:\\a.txt'], true, 'C:\\a.txt')
    expect(fakeFiles()).toEqual({ paths: ['C:\\a.txt'], cut: true })
    expect(cb.readText()).toBe('C:\\a.txt')
    cb.writeText('x')
    expect(fakeFiles()).toBeNull()
  })
})
