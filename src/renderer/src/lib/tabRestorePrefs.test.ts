import { beforeEach, describe, expect, it } from 'vitest'
import { rememberTabs, setRememberTabs } from './tabRestorePrefs'

describe('tabRestorePrefs', () => {
  beforeEach(() => localStorage.clear())
  it('remembers tabs until somebody says not to', () => {
    expect(rememberTabs()).toBe(true)
    setRememberTabs(false)
    expect(localStorage.getItem('prism.tabs.remember')).toBe('off')
    expect(rememberTabs()).toBe(false)
    setRememberTabs(true)
    expect(rememberTabs()).toBe(true)
  })
})
