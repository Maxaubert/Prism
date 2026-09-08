import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileVerbs } from './fileVerbs'

// The unit tests run under node, where `window` does not exist; in a browser
// it IS globalThis, which is what the phone shim leans on too.
if (typeof window === 'undefined')
  Object.defineProperty(globalThis, 'window', { value: globalThis })

const install = (explorer: boolean): { showInExplorer: ReturnType<typeof vi.fn> } => {
  const showInExplorer = vi.fn()
  ;(globalThis as unknown as { prism: unknown }).prism = {
    capabilities: { write: explorer, clipboard: explorer, explorer, drag: explorer },
    showInExplorer
  }
  return { showInExplorer }
}

// Copying text needs a clipboard, and which one differs by host: the app
// window has `navigator.clipboard` (a secure context), the phone page has
// only `document.execCommand`, and this test host has neither until it is
// given one. A row that cannot copy is not offered at all, so the test says
// which host it is standing in.
let writeText: ReturnType<typeof vi.fn>
beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText } },
    configurable: true
  })
})

describe('fileVerbs', () => {
  afterEach(() => {
    delete (globalThis as unknown as { prism?: unknown }).prism
  })
  it('offers Explorer and the path on the desktop', () => {
    const { showInExplorer } = install(true)
    const verbs = fileVerbs('C:\\a\\b.txt')
    expect(verbs.map((v) => v.label)).toEqual(['Show in File Explorer', 'Copy path'])
    verbs[0].onPick?.()
    expect(showInExplorer).toHaveBeenCalledWith('C:\\a\\b.txt')
  })
  it('keeps only Copy path where there is no Explorer to show a file in', () => {
    install(false)
    const verbs = fileVerbs('C:\\a\\b.txt')
    expect(verbs.map((v) => v.label)).toEqual(['Copy path'])
    verbs[0].onPick?.()
    expect(writeText).toHaveBeenCalledWith('C:\\a\\b.txt')
  })
  it('offers no row at all where nothing can copy: it would do nothing', () => {
    install(false)
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
    expect(fileVerbs('C:\\a\\b.txt')).toEqual([])
  })
})
