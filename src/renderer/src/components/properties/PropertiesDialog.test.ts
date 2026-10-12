import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { FileKind } from '@shared/types'
import type { BrowseDriveUsage } from '@shared/browse'
import { PropertiesDialog } from './PropertiesDialog'

// THE FRAME PICKS THE BODY (owner, 2026-10-12; spec
// docs/superpowers/specs/2026-10-12-properties-window-design.md). A static
// render runs no effects, so each body shows its first frame: the header, the
// waiting facts and the footer. What it must hold: the right body per kind,
// Close as the only button but on a drive, and the checksum on a file.

beforeAll(() => {
  const prism = { mediaUrl: (p: string) => `fsmedia://local/${encodeURIComponent(p)}` }
  Object.defineProperty(globalThis, 'window', { value: { prism }, configurable: true })
})

const render = (props: {
  path: string
  name: string
  kind?: FileKind
  isFolder?: boolean
  drive?: BrowseDriveUsage
  onOpenFolder?: (path: string) => void
}): string =>
  renderToStaticMarkup(
    createElement(PropertiesDialog, {
      root: 'C:\\Users',
      kind: 'other',
      isFolder: false,
      onClose: () => {},
      ...props
    })
  )

const buttons = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, '') || 'icon')

describe('PropertiesDialog', () => {
  it('a drive: its name, Disk Cleanup, Open and Close', () => {
    const html = render({
      path: 'C:\\',
      name: 'C:\\',
      isFolder: true,
      drive: { path: 'C:\\', kind: 'local', total: 100, free: 40 },
      onOpenFolder: () => {}
    })
    expect(html).toContain('data-props-body="drive"')
    expect(html).toContain('Local Disk (C:)')
    expect(buttons(html)).toEqual(['Disk Cleanup', 'Open', 'Close'])
  })

  it('a drive with nowhere to open it has no Open', () => {
    const html = render({ path: 'D:\\', name: 'D:\\', isFolder: true, drive: { path: 'D:\\', label: 'Data' } })
    expect(html).toContain('Data (D:)')
    expect(buttons(html)).toEqual(['Disk Cleanup', 'Close'])
  })

  it('a folder: its path to copy, the size rows, and Close only', () => {
    const html = render({ path: 'C:\\Users\\Admin\\Pics', name: 'Pics', isFolder: true })
    expect(html).toContain('data-props-body="folder"')
    expect(html).toContain('C:\\Users\\Admin\\Pics')
    expect(html).toContain('>Size<')
    expect(html).not.toContain('SHA-256')
    expect(buttons(html)).toEqual(['icon', 'Close'])
  })

  it('a photo: the picture across the top and a checksum', () => {
    const html = render({ path: 'C:\\Users\\a.png', name: 'a.png', kind: 'image' })
    expect(html).toContain('data-props-body="photo"')
    expect(html).toContain('src="fsmedia://local/C%3A%5CUsers%5Ca.png"')
    expect(html).toContain('SHA-256')
    expect(buttons(html)).toEqual(['Compute', 'Close'])
  })

  it('picks the body for each file kind', () => {
    const body = (kind: FileKind, name: string): string | undefined =>
      /data-props-body="(\w+)"/.exec(render({ path: `C:\\Users\\${name}`, name, kind }))?.[1]
    expect(body('video', 'a.mp4')).toBe('video')
    expect(body('audio', 'a.flac')).toBe('audio')
    expect(body('text', 'a.py')).toBe('text')
    expect(body('pdf', 'a.pdf')).toBe('other')
    expect(body('archive', 'a.zip')).toBe('other')
  })

  it('a text file names its language with a dot while the rest reads', () => {
    const html = render({ path: 'C:\\Users\\thumbs.py', name: 'thumbs.py', kind: 'text' })
    expect(html).toContain('thumbs.py')
    expect(html).toContain('C:\\Users')
    expect(html).toContain('Reading…')
    expect(buttons(html)).toEqual(['Close'])
  })
})
