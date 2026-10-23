import { beforeAll, describe, expect, it } from 'vitest'

// PRISM'S DICTATION KEY IS RIGHT ALT (2026-10-23). Core 0.43.0 moved the core's
// own default to Ctrl+Win; Prism declares Right Alt in its host config, so a
// user who never saved a key keeps the key Prism documents (#429's red gate).

describe("Prism's terminal host", () => {
  beforeAll(async () => {
    localStorage.clear()
    // termHost.ts hands `window.prism` to the core at import; the bridge itself
    // is never called here.
    Object.defineProperty(globalThis, 'window', { value: { prism: {} }, configurable: true })
    await import('./termHost')
  })

  it('dictates with Right Alt when no key was ever saved', async () => {
    const { dictationHotkey } = await import('prism-term-core/renderer/lib/dictationPrefs')
    const { formatHotkey } = await import('prism-term-core/renderer/lib/dictationKey')
    expect(formatHotkey(dictationHotkey())).toBe('Right Alt')
  })
})
