import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStored } from './storage'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('readStored', () => {
  it('reads what is stored', () => {
    localStorage.setItem('prism.test.key', '1')
    expect(readStored('prism.test.key')).toBe('1')
    expect(readStored('prism.test.missing')).toBeNull()
  })

  it('reads a refusing storage as never set, never throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => readStored('prism.sidebar.width')).not.toThrow()
    expect(readStored('prism.sidebar.width')).toBeNull()
  })
})
