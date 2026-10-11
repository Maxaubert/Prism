import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docMenu } from './doc'

// The unit tests run under node, where `window` does not exist; in a browser
// it IS globalThis, which is what the phone shim leans on too.
if (typeof window === 'undefined')
  Object.defineProperty(globalThis, 'window', { value: globalThis })

/** The desktop (every capability) or the phone page (#106: none of them). */
const host = (desktop: boolean): { openInDefault: ReturnType<typeof vi.fn> } => {
  const openInDefault = vi.fn()
  ;(globalThis as unknown as { prism: unknown }).prism = {
    capabilities: { write: desktop, clipboard: desktop, explorer: desktop, drag: desktop },
    showInExplorer: vi.fn(),
    openInDefault
  }
  return { openInDefault }
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

describe('the document reader menu', () => {
  it('on the desktop', () => {
    const { openInDefault } = host(true)
    const items = docMenu({ path: 'C:\\docs\\a.docx', find: vi.fn() })
    expect(items.map((i) => i.label)).toEqual([
      'Find',
      'Open in default app',
      'Show in File Explorer',
      'Copy path'
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
