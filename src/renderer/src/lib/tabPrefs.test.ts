import { beforeEach, describe, expect, it } from 'vitest'
import { confirmCloseMode, setConfirmCloseMode } from './tabPrefs'

beforeEach(() => localStorage.clear())

describe('ask before closing tabs', () => {
  it('defaults to protecting agent sessions', () => {
    expect(confirmCloseMode()).toBe('agent')
  })
  it('round-trips both modes', () => {
    for (const mode of ['never', 'agent'] as const) {
      setConfirmCloseMode(mode)
      expect(confirmCloseMode()).toBe(mode)
    }
  })
  it('migrates legacy confirmation to agent protection and retains opt-out', () => {
    localStorage.setItem('prism.tabs.confirmClose', '1')
    expect(confirmCloseMode()).toBe('agent')
    localStorage.setItem('prism.tabs.confirmClose', '0')
    expect(confirmCloseMode()).toBe('never')
  })
  it('treats garbage as the default', () => {
    localStorage.setItem('prism.tabs.confirmClose', 'soup')
    expect(confirmCloseMode()).toBe('agent')
  })
})
