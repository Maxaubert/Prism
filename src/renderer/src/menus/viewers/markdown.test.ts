import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markdownMenu } from './markdown'
import { aliasWindow, capabilityHost, clearHost, fakeClipboard } from '../../testing/host'

aliasWindow()

/** The desktop (every capability) or the phone page (#106: none of them). */
const host = (desktop: boolean): void => void capabilityHost(desktop)
beforeEach(() => {
  fakeClipboard()
})
afterEach(clearHost)

describe('the markdown reader menu', () => {
  it('on the desktop', () => {
    host(true)
    const items = markdownMenu({ path: 'C:\\notes\\a.md', find: vi.fn() })
    expect(items.map((i) => i.label)).toEqual(['Find', 'Copy path', 'Show in File Explorer'])
    expect(items[0].hint).toBe('Ctrl+F')
  })

  it('on the phone page', () => {
    host(false)
    const items = markdownMenu({ path: 'C:\\notes\\a.md', find: vi.fn() })
    expect(items.map((i) => i.label)).toEqual(['Find', 'Copy path'])
  })
})
