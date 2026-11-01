import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '../../components/ContextMenu'
import { imageMenu, type ImageMenuContext } from './image'
import { aliasWindow, capabilityHost, clearHost, fakeClipboard } from '../../testing/host'

aliasWindow()

/** The desktop (every capability) or the phone page (#106: none of them). */
const host = (desktop: boolean): void => void capabilityHost(desktop)
beforeEach(() => {
  fakeClipboard()
})
afterEach(clearHost)

const ctx = (over: Partial<ImageMenuContext> = {}): ImageMenuContext => ({
  path: 'C:\\pics\\a.jpg',
  hasImage: true,
  canSlideshow: true,
  slideshow: false,
  slideSecs: 5,
  photoInfo: false,
  togglePhotoInfo: vi.fn(),
  rotate: vi.fn(),
  copyImage: vi.fn(() => Promise.resolve()),
  saveCopy: vi.fn(() => Promise.resolve()),
  setSlideshow: vi.fn(),
  setSlideSecs: vi.fn(),
  ...over
})
const labels = (items: MenuItem[]): string[] => items.map((i) => i.label)
const row = (items: MenuItem[], label: string): MenuItem => {
  const found = items.find((i) => i.label === label)
  if (!found) throw new Error(`no row "${label}"`)
  return found
}

describe('the picture menu', () => {
  it('a loaded picture on the desktop, in a folder that steps', () => {
    host(true)
    const items = imageMenu(ctx())
    expect(labels(items)).toEqual([
      'Rotate',
      'Photo info',
      'Copy image',
      'Copy path',
      'Save a copy',
      'Slideshow',
      'Show in File Explorer'
    ])
    // The Explorer's Save copies as list, in its order (#474).
    expect(labels(row(items, 'Save a copy').children ?? [])).toEqual(['JPEG', 'PNG', 'WebP', 'AVIF', 'JPEG XL'])
    expect(labels(row(items, 'Slideshow').children ?? [])).toEqual([
      '2 seconds',
      '3 seconds',
      '5 seconds',
      '10 seconds',
      '20 seconds'
    ])
    expect(row(items, 'Copy image').disabled).toBe(false)
  })

  it('a running slideshow offers to stop it', () => {
    host(true)
    expect(labels(imageMenu(ctx({ slideshow: true })))).toContain('Stop slideshow')
  })

  it('greys the pixel verbs until the picture has loaded', () => {
    host(true)
    const items = imageMenu(ctx({ hasImage: false }))
    expect(row(items, 'Copy image').disabled).toBe(true)
    expect(row(items, 'Save a copy').disabled).toBe(true)
  })

  it('no slideshow where the folder cannot step, no file rows without a path', () => {
    host(true)
    expect(labels(imageMenu(ctx({ canSlideshow: false, path: undefined })))).toEqual([
      'Rotate',
      'Copy image',
      'Save a copy'
    ])
  })

  it('the phone page: no clipboard, no save dialog, no Explorer, no photo info', () => {
    host(false)
    expect(labels(imageMenu(ctx({ togglePhotoInfo: undefined })))).toEqual(['Rotate', 'Copy path', 'Slideshow'])
  })

  // #78, D7 (owner, 2026-11-01): the I key's card has a row, so it can be found.
  it('Photo info: ticked while the card is on, and a pick toggles it', () => {
    host(true)
    const toggle = vi.fn()
    const off = row(imageMenu(ctx({ togglePhotoInfo: toggle })), 'Photo info')
    const on = row(imageMenu(ctx({ photoInfo: true })), 'Photo info')
    const ticked = (item: MenuItem): boolean => (item.icon?.props as { name?: string } | undefined)?.name === 'tick'
    expect(ticked(off)).toBe(false)
    expect(ticked(on)).toBe(true)
    // No shortcut hint (the 2026-08-31 menu rule).
    expect(off.hint).toBeUndefined()
    off.onPick?.()
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('no Photo info for a picture with no file of its own (a comic page, an old-panel member)', () => {
    host(true)
    expect(labels(imageMenu(ctx({ path: undefined })))).not.toContain('Photo info')
  })
})
