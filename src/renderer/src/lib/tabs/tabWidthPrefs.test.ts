import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onTabWidthChange, setTabWidth, tabWidth, tabWidthClass } from './tabWidthPrefs'

describe('tabWidthPrefs', () => {
  beforeEach(() => localStorage.clear())

  it('is dynamic until somebody chooses (owner, 2026-09-23: "have dynamic be the default")', () => {
    expect(tabWidth()).toBe('dynamic')
  })

  it('remembers both choices under its own key', () => {
    for (const w of ['fixed', 'dynamic'] as const) {
      setTabWidth(w)
      expect(tabWidth()).toBe(w)
      expect(localStorage.getItem('prism.window.tabWidth')).toBe(w)
    }
  })

  it('reads a word it does not know as dynamic, and never stores one', () => {
    localStorage.setItem('prism.window.tabWidth', 'wide')
    expect(tabWidth()).toBe('dynamic')
    setTabWidth('huge' as never)
    expect(localStorage.getItem('prism.window.tabWidth')).toBe('dynamic')
  })

  it('tells its listeners on a change, and stops when asked', () => {
    const heard = vi.fn()
    const off = onTabWidthChange(heard)
    setTabWidth('fixed')
    expect(heard).toHaveBeenCalledTimes(1)
    off()
    setTabWidth('dynamic')
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('tabWidthClass (audit #18)', () => {
  it('both modes keep a 64px floor, so the strip scrolls instead of tabs overlapping', () => {
    expect(tabWidthClass('dynamic')).toContain('min-w-[64px]')
    expect(tabWidthClass('dynamic')).not.toContain('min-w-0')
    expect(tabWidthClass('fixed')).toContain('min-w-[64px]')
  })
})