// What a unit test stands in for: the browser's `window`, the host's
// `window.prism`, and the clipboard. The menu and phone tests each used to
// write these out for themselves.
import { vi } from 'vitest'

type Spy = ReturnType<typeof vi.fn>

/** The unit tests run under node, where `window` does not exist; in a browser
 *  it IS globalThis, which is what the menus and the phone shim lean on.
 *  Call it where the copies stood, so modules imported above still load
 *  without it. */
export function aliasWindow(): void {
  if (typeof window === 'undefined') Object.defineProperty(globalThis, 'window', { value: globalThis })
}

/** Stand in for `window.prism`. */
export function setHost(prism: Record<string, unknown>): void {
  ;(globalThis as unknown as { prism: unknown }).prism = prism
}

/** Take the stand-in away again (an afterEach). */
export function clearHost(): void {
  delete (globalThis as unknown as { prism?: unknown }).prism
}

/** The desktop (every capability) or the phone page (#106: none of them),
 *  with a `showInExplorer` spy and any `extra` calls the test watches. */
export function capabilityHost(desktop: boolean, extra: Record<string, unknown> = {}): { showInExplorer: Spy } {
  const showInExplorer = vi.fn()
  setHost({
    capabilities: { write: desktop, clipboard: desktop, explorer: desktop, drag: desktop },
    showInExplorer,
    ...extra
  })
  return { showInExplorer }
}

/** A `navigator.clipboard` whose `writeText` is the spy given (or a fresh
 *  one): copying text needs one, and this test host has none until given. */
export function fakeClipboard(writeText: Spy = vi.fn(() => Promise.resolve())): Spy {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText } },
    configurable: true
  })
  return writeText
}
