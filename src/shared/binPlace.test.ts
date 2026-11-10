import { isAbsolute } from 'path'
import { describe, expect, it } from 'vitest'
import { BIN_NAME, BIN_PLACE, binPlaceOf, isBinPlace } from './binPlace'
import { pastedPath } from './path'

describe('the Recycle Bin place (D5)', () => {
  it('is Windows own name for the bin, and is never an absolute path', () => {
    expect(BIN_PLACE).toBe('shell:RecycleBinFolder')
    expect(BIN_NAME).toBe('Recycle Bin')
    // Every isAbsolute guard (the walls, the file ops) refuses it by default.
    expect(isAbsolute(BIN_PLACE)).toBe(false)
  })

  it('isBinPlace is exactly the sentinel, in any case', () => {
    expect(isBinPlace(BIN_PLACE)).toBe(true)
    expect(isBinPlace('SHELL:recyclebinfolder')).toBe(true)
    expect(isBinPlace('Recycle Bin')).toBe(false)
    expect(isBinPlace('C:\\Recycle Bin')).toBe(false)
    expect(isBinPlace('shell:RecycleBinFolder\\x')).toBe(false)
    expect(isBinPlace(undefined)).toBe(false)
    expect(isBinPlace(7)).toBe(false)
  })

  it('typed text finds it: Recycle Bin, the shell name, any case, quotes and spaces', () => {
    for (const text of [
      'Recycle Bin',
      'recycle bin',
      ' "Recycle Bin" ',
      'shell:RecycleBinFolder',
      'SHELL:RECYCLEBINFOLDER'
    ])
      expect(binPlaceOf(text)).toBe(BIN_PLACE)
    expect(binPlaceOf('Recycle Bin 2')).toBeNull()
    expect(binPlaceOf('C:\\Recycle Bin')).toBeNull()
    expect(binPlaceOf('')).toBeNull()
  })

  it('pastedPath maps both spellings to the sentinel', () => {
    expect(pastedPath('Recycle Bin')).toBe(BIN_PLACE)
    expect(pastedPath('shell:recyclebinfolder')).toBe(BIN_PLACE)
    expect(pastedPath('some/words')).toBe('some/words')
  })
})
