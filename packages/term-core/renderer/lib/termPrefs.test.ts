import { beforeEach, describe, expect, it } from 'vitest'
import { savedShellId, saveShellId } from './termPrefs'

beforeEach(() => localStorage.clear())

describe('the saved shell', () => {
  it('is undefined until chosen, and never an empty string', () => {
    expect(savedShellId()).toBeUndefined()
    localStorage.setItem('prism.term.shell', '')
    expect(savedShellId()).toBeUndefined()
  })
  it('round-trips', () => {
    saveShellId('wsl-Ubuntu')
    expect(savedShellId()).toBe('wsl-Ubuntu')
  })
})
