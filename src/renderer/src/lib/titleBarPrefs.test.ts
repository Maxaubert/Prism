import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onTitleBarChange, setTitleBarMode, titleBarMode } from './titleBarPrefs'

describe('titleBarPrefs', () => {
  beforeEach(() => localStorage.clear())

  it('is shown until somebody chooses, so no window changes with the update', () => {
    expect(titleBarMode()).toBe('shown')
  })

  it('remembers both choices under the same key as Prism Terminal', () => {
    for (const m of ['hidden', 'shown'] as const) {
      setTitleBarMode(m)
      expect(titleBarMode()).toBe(m)
      expect(localStorage.getItem('prism.window.titleBar')).toBe(m)
    }
  })

  it('reads a word it does not know as shown, and never stores one', () => {
    localStorage.setItem('prism.window.titleBar', 'gone')
    expect(titleBarMode()).toBe('shown')
    setTitleBarMode('off' as never)
    expect(localStorage.getItem('prism.window.titleBar')).toBe('shown')
  })

  it('reads a store that throws as shown, and a write to it does not throw', () => {
    const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      expect(titleBarMode()).toBe('shown')
      expect(() => setTitleBarMode('hidden')).not.toThrow()
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })

  it('tells its listeners on a change, and stops when asked', () => {
    const heard = vi.fn()
    const off = onTitleBarChange(heard)
    setTitleBarMode('hidden')
    expect(heard).toHaveBeenCalledTimes(1)
    off()
    setTitleBarMode('shown')
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
