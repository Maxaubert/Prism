import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markdownMenu } from './markdown'

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
