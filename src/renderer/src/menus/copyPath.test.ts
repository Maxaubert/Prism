import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '../components/ContextMenu'
import { tabContextMenu } from './tabStrip'
import { videoMenu } from './viewers/video'
import { archivePanelMenu } from './viewers/archivePanel'
import { clipboardText } from '../lib/clipboardText'
import { aliasWindow, capabilityHost, clearHost } from '../testing/host'

/**
 * EVERY COPY PATH COPIES ON THE PHONE PAGE (#511). The phone page is plain
 * http, so `navigator.clipboard` is not there; the film, archive-panel and tab
 * menus called it directly and threw. They now go through clipboardText, which
 * owns the fallback (its own tests cover that). This host has no
 * `navigator.clipboard` at all, like the phone, so a row that still reaches
 * for it throws here.
 */

vi.mock('../lib/clipboardText', () => ({ canCopyText: () => true, clipboardText: vi.fn(() => true) }))

aliasWindow()

beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
  vi.mocked(clipboardText).mockClear()
  capabilityHost(true, { copyImageToClipboard: vi.fn() })
})
afterEach(clearHost)

const pick = (items: MenuItem[], label: string): void => {
  const row = items.find((i) => i.label === label)
  expect(row, label).toBeDefined()
  row!.onPick?.()
}

describe('Copy path without navigator.clipboard (the phone page)', () => {
  it('the tab menu copies', () => {
    pick(tabContextMenu({ root: 'C:\\a', onClose: vi.fn() }), 'Copy path')
    expect(clipboardText).toHaveBeenCalledWith('C:\\a')
  })
  it('the film menu copies', () => {
    const items = videoMenu({
      path: 'C:\\films\\a.mkv',
      onStep: vi.fn(),
      canStep: () => true,
      fit: 'fit',
      pickFit: vi.fn(),
      rate: 1,
      setRate: vi.fn(),
      audioTracks: [],
      track: null,
      setTrack: vi.fn(),
      trackLabel: () => '',
      subtitles: { tracks: [], active: null, pick: vi.fn(), add: vi.fn() },
      hasFrame: false,
      el: null
    } as unknown as Parameters<typeof videoMenu>[0])
    pick(items, 'Copy path')
    expect(clipboardText).toHaveBeenCalledWith('C:\\films\\a.mkv')
  })
  it('the archive panel copies', () => {
    pick(
      archivePanelMenu({
        archivePath: 'C:\\a.zip',
        zip: 'a.zip',
        caps: { write: false, clipboard: false, explorer: false, drag: false },
        writable: false,
        busy: false,
        hasRows: false,
        extractAll: vi.fn(),
        addFiles: vi.fn(),
        selectAll: vi.fn()
      } as unknown as Parameters<typeof archivePanelMenu>[0]),
      // The archive's own place, so the table's word for it (#518).
      'Copy address'
    )
    expect(clipboardText).toHaveBeenCalledWith('C:\\a.zip')
  })
})
