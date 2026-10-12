import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docMenu } from './doc'
import { aliasWindow, capabilityHost, clearHost, fakeClipboard } from '../../testing/host'

aliasWindow()

/** The desktop (every capability) or the phone page (#106: none of them). */
const host = (desktop: boolean): { openInDefault: ReturnType<typeof vi.fn> } => {
  const openInDefault = vi.fn()
  capabilityHost(desktop, { openInDefault })
  return { openInDefault }
}
beforeEach(() => {
  fakeClipboard()
})
afterEach(clearHost)

describe('the document reader menu', () => {
  it('on the desktop', () => {
    const { openInDefault } = host(true)
    const items = docMenu({ path: 'C:\\docs\\a.docx', find: vi.fn() })
    expect(items.map((i) => i.label)).toEqual([
      'Find',
      'Open in default app',
      'Copy path',
      'Show in File Explorer'
    ])
    items[1].onPick?.()
    expect(openInDefault).toHaveBeenCalledWith('C:\\docs\\a.docx')
  })

  it('on the phone page', () => {
    host(false)
    const items = docMenu({ path: 'C:\\docs\\a.docx', find: vi.fn() })
    expect(items.map((i) => i.label)).toEqual(['Find', 'Open in default app', 'Copy path'])
  })
})
