import { beforeEach, describe, expect, it } from 'vitest'
import { confirmCloseMode, setConfirmCloseMode } from './tabPrefs'

beforeEach(() => localStorage.clear())

describe('ask before closing tabs', () => {
  it("defaults to 'always': a reflex close should not silently take a tab and its shell", () => {
    expect(confirmCloseMode()).toBe('always')
  })
  it('round-trips all three modes', () => {
    for (const mode of ['never', 'agent', 'always'] as const) {
      setConfirmCloseMode(mode)
      expect(confirmCloseMode()).toBe(mode)
    }
  })
  it("keeps the old boolean setting's meaning: '1' is always, '0' is never", () => {
    localStorage.setItem('prism.tabs.confirmClose', '1')
    expect(confirmCloseMode()).toBe('always')
    localStorage.setItem('prism.tabs.confirmClose', '0')
    expect(confirmCloseMode()).toBe('never')
  })
  it('treats garbage as the default', () => {
    localStorage.setItem('prism.tabs.confirmClose', 'soup')
    expect(confirmCloseMode()).toBe('always')
  })
})
