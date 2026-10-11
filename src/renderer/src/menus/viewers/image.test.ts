import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '../../components/ContextMenu'
import { imageMenu, type ImageMenuContext } from './image'

// The unit tests run under node, where `window` does not exist; in a browser
// it IS globalThis, which is what the phone shim leans on too.
if (typeof window === 'undefined')
  Object.defineProperty(globalThis, 'window', { value: globalThis })

/** The desktop (every capability) or the phone page (#106: none of them). */
const host = (desktop: boolean): void => {
  ;(globalThis as unknown as { prism: unknown }).prism = {
    capabilities: { write: desktop, clipboard: desktop, explorer: desktop, drag: desktop },
    showInExplorer: vi.fn()
  }
}
beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: vi.fn(() => Promise.resolve()) } },
    configurable: true
  })
})
afterEach(() => {
  delete (globalThis as unknown as { prism?: unknown }).prism
})

const ctx = (over: Partial<ImageMenuContext> = {}): ImageMenuContext => ({
  path: 'C:\\pics\\a.jpg',
  hasImage: true,
  canSlideshow: true,
  slideshow: false,
  slideSecs: 5,
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
      'Copy image',
      'Save a copy',
      'Slideshow',
      'Show in File Explorer',
      'Copy path'
    ])
    expect(labels(row(items, 'Save a copy').children ?? [])).toEqual(['PNG', 'JPEG'])
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

  it('the phone page: no clipboard, no save dialog, no Explorer', () => {
    host(false)
    expect(labels(imageMenu(ctx()))).toEqual(['Rotate', 'Slideshow', 'Copy path'])
  })
})
