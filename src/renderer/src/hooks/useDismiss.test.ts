import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindDismiss } from './useDismiss'
import type { OwnWindow } from '../lib/ownWindow'

// A popover in the preview window is dismissed from THAT window (audit #43): its keys and presses never reach
// this page's `window`.
type Fake = OwnWindow & { on: Map<string, ((e: unknown) => void)[]>; doc: Document }
function fakeWindow(): Fake {
  const on = new Map<string, ((e: unknown) => void)[]>()
  const w = {
    on,
    addEventListener: (t: string, f: (e: unknown) => void) => on.set(t, [...(on.get(t) ?? []), f]),
    removeEventListener: (t: string, f: (e: unknown) => void) => on.set(t, (on.get(t) ?? []).filter((x) => x !== f))
  } as unknown as Fake
  const doc = { nodeType: 9, defaultView: w } as unknown as Document
  Object.assign(w, { doc, document: doc })
  return w
}
const fire = (w: Fake, type: string, e: unknown): void => (w.on.get(type) ?? []).forEach((f) => f(e))
const boxIn = (w: Fake): { current: HTMLElement } => ({
  current: { nodeType: 1, ownerDocument: w.doc, contains: () => false } as unknown as HTMLElement
})

describe('bindDismiss', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('hears Escape and a press outside in the preview window, and blur on its own window only', () => {
    const page = fakeWindow()
    const preview = fakeWindow()
    vi.stubGlobal('window', page)
    const shut = vi.fn()
    const esc = vi.fn()
    const undo = bindDismiss(boxIn(preview), shut, esc, false)
    fire(preview, 'keydown', { key: 'Escape', stopPropagation: () => {} })
    expect(esc).toHaveBeenCalledTimes(1)
    fire(preview, 'pointerdown', { target: { nodeType: 1, ownerDocument: preview.doc, closest: () => null } })
    expect(shut).toHaveBeenCalledTimes(1)
    expect(preview.on.get('blur')?.length).toBe(1)
    expect(page.on.get('blur')?.length ?? 0).toBe(0)
    undo()
    expect(preview.on.get('keydown')).toEqual([])
    expect(page.on.get('keydown')).toEqual([])
  })

  it('in the main window it listens on that window alone, as before', () => {
    const page = fakeWindow()
    vi.stubGlobal('window', page)
    bindDismiss(boxIn(page), vi.fn(), vi.fn(), true)
    expect(page.on.get('keydown')?.length).toBe(1)
    expect(page.on.get('resize')?.length).toBe(1)
  })
})