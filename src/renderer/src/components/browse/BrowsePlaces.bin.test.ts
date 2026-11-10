import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowsePlaces } from './BrowsePlaces'
import { aliasWindow, clearHost, setHost } from '../../testing/host'

aliasWindow()
afterEach(clearHost)

const videos = {
  label: 'Videos',
  path: 'C:\\Users\\m\\Videos',
  group: 'Quick access' as const,
  known: 'videos'
}

/** The Quick access section's buttons, as opening tags plus their text. */
function quickAccessRows(pinned: boolean): { tag: string; text: string }[] {
  setHost({ capabilities: { write: true, clipboard: true, explorer: true, drag: true } })
  const html = renderToStaticMarkup(
    createElement(BrowsePlaces, {
      places: [videos],
      directory: 'C:\\Users\\m',
      onNavigate: vi.fn(),
      quickAccess: pinned ? [{ path: videos.path, label: 'Videos', isFolder: true }] : []
    } as never)
  )
  const section = /<section[^>]*aria-label="Quick access"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? ''
  return [...section.matchAll(/(<button[^>]*>)([\s\S]*?)<\/button>/g)].map((m) => ({
    tag: m[1],
    text: m[2].replace(/<[^>]*>/g, '')
  }))
}

describe('the Recycle Bin row (D19)', () => {
  it('is the LAST row of Quick access, after Videos, with the pin classes', () => {
    const rows = quickAccessRows(true)
    expect(rows.map((r) => r.text)).toEqual(['Videos', 'Recycle Bin'])
    expect(rows[1].tag).toContain('class="browse-place quick-access-pin"')
    expect(rows[1].tag).toContain('data-bin-place')
  })
  it('is not a pin: not draggable, no quick-access path', () => {
    const { tag } = quickAccessRows(true)[1]
    expect(tag).toContain('draggable="false"')
    expect(tag).not.toContain('data-quick-access-path')
  })
  it('has the bin glyph and a Recycle Bin tooltip', () => {
    const { tag } = quickAccessRows(true)[1]
    expect(tag).toContain('title="Recycle Bin"')
    setHost({ capabilities: {} })
    const html = renderToStaticMarkup(
      createElement(BrowsePlaces, { places: [videos], directory: 'C:\\', onNavigate: vi.fn(), quickAccess: [] } as never)
    )
    expect(html).toContain('data-place-icon="bin"')
  })
  it('the section is drawn with every Known Folder unpinned', () => {
    expect(quickAccessRows(false).map((r) => r.text)).toEqual(['Recycle Bin'])
  })
})
