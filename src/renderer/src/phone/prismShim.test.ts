import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installShim } from './prismShim'
import { writeToken } from './api'

// The unit tests run under node, where `window` does not exist; in a browser
// it IS globalThis, which is where the shim installs itself.
if (typeof window === 'undefined')
  Object.defineProperty(globalThis, 'window', { value: globalThis })

describe('the phone shim', () => {
  beforeEach(() => {
    localStorage.clear()
    writeToken('tok')
    installShim()
  })
  it('builds media urls with the token', () => {
    expect(window.prism.mediaUrl('C:\\x.mp4')).toBe('/m/C%3A%5Cx.mp4?t=tok')
  })
  it('answers the media probe as nothing to decode', async () => {
    await expect(window.prism.probeMedia('C:\\x.mp4')).resolves.toEqual({
      ffmpeg: false,
      needed: false
    })
  })
  it('says what it cannot do, and never throws for it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Neither is on PrismApi yet: `capabilities` is the shim's own, and
    // `nativeDrag` arrives with #103.
    const p = window.prism as unknown as {
      nativeDrag: boolean
      capabilities: unknown
      trashFile: (p: string) => Promise<unknown>
    }
    expect(p.nativeDrag).toBe(false)
    expect(p.capabilities).toEqual({ write: false, clipboard: false, explorer: false, drag: false })
    await expect(p.trashFile('x')).resolves.toBe(false)
    await expect(p.trashFile('y')).resolves.toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
  it('is not a thenable, so nothing awaiting it hangs', () => {
    expect((window.prism as unknown as { then?: unknown }).then).toBeUndefined()
  })
})
