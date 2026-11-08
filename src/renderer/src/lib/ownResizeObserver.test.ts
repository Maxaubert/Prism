import { afterEach, describe, expect, it, vi } from 'vitest'
import { ownResizeObserver } from './ownResizeObserver'

class Here {
  constructor(public cb: ResizeObserverCallback) {}
}
class There {
  constructor(public cb: ResizeObserverCallback) {}
}

describe('ownResizeObserver', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("is made from the element's own window (the preview window's)", () => {
    vi.stubGlobal('ResizeObserver', Here)
    const cb = (): void => {}
    const el = { ownerDocument: { defaultView: { ResizeObserver: There } } } as unknown as Element
    const ro = ownResizeObserver(el, cb) as unknown as There
    expect(ro).toBeInstanceOf(There)
    expect(ro.cb).toBe(cb)
  })

  it('falls back to this window when the element has none', () => {
    vi.stubGlobal('ResizeObserver', Here)
    const el = { ownerDocument: { defaultView: null } } as unknown as Element
    expect(ownResizeObserver(el, () => {})).toBeInstanceOf(Here)
  })
})
