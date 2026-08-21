import { beforeEach, describe, expect, it } from 'vitest'
import { confirmCloseTabs, setConfirmCloseTabs } from './tabPrefs'

beforeEach(() => localStorage.clear())

describe('ask before closing tabs', () => {
  it('defaults ON: a reflex close should not silently take a tab and its shell', () => {
    expect(confirmCloseTabs()).toBe(true)
  })
  it('round-trips the opt-out', () => {
    setConfirmCloseTabs(false)
    expect(confirmCloseTabs()).toBe(false)
    setConfirmCloseTabs(true)
    expect(confirmCloseTabs()).toBe(true)
  })
  it('treats garbage as the default', () => {
    localStorage.setItem('prism.tabs.confirmClose', 'soup')
    expect(confirmCloseTabs()).toBe(true)
  })
})
