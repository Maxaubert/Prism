import { describe, expect, it } from 'vitest'
import { terminalRestoreOrder } from './terminalRestore'

describe('terminal pin restore slots', () => {
  it('keeps a pin on an older shell distinct when the second shell was current', () => {
    const terms = ['older-shell', 'current-shell', 'third-shell']
    const savedOrder = terminalRestoreOrder(terms, 'current-shell')
    const newShells = ['resumed-current', 'fresh-older', 'fresh-third']
    expect(newShells[savedOrder.indexOf('older-shell')]).toBe('fresh-older')
    expect(newShells[savedOrder.indexOf('current-shell')]).toBe('resumed-current')
    expect(newShells[savedOrder.indexOf('third-shell')]).toBe('fresh-third')
    expect(terms).toEqual(['older-shell', 'current-shell', 'third-shell'])
  })

  it('keeps the original order when the first shell was current', () => {
    expect(terminalRestoreOrder(['one', 'two'], 'one')).toEqual(['one', 'two'])
  })

  it('does not invent a slot when the current shell is missing', () => {
    expect(terminalRestoreOrder(['one'], 'gone')).toEqual(['one'])
    expect(terminalRestoreOrder([])).toEqual([])
  })
})
