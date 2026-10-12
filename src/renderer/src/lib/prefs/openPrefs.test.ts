import { beforeEach, describe, expect, it } from 'vitest'
import { openMode, setOpenMode } from './openPrefs'

describe('openPrefs', () => {
  beforeEach(() => localStorage.clear())

  it('is Preview until somebody chooses (owner: "default should be preview")', () => {
    expect(openMode()).toBe('preview')
  })

  it('remembers Full view, and going back', () => {
    setOpenMode('full')
    expect(openMode()).toBe('full')
    setOpenMode('preview')
    expect(openMode()).toBe('preview')
  })

  it('reads anything it did not write as the default', () => {
    for (const junk of ['', 'Full', 'maximized', 'null']) {
      localStorage.setItem('prism.open.external', junk)
      expect(openMode(), junk).toBe('preview')
    }
  })
})
