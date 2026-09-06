import { afterEach, describe, expect, it, vi } from 'vitest'
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
    // The clipboard here is the browser's own writeText, which a phone has.
    expect(fileVerbs('C:\\a\\b.txt').map((v) => v.label)).toEqual(['Copy path'])
  })
})
