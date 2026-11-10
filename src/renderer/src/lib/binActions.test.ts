import { describe, expect, it } from 'vitest'
import {
  binDeleteFailure,
  binHoldDirs,
  binRestoreFailure,
  binStopped,
  namesOfBinPaths
} from './binActions'
import { BIN_PLACE } from '@shared/binPlace'

describe('binActions (Recycle Bin, D13 to D17)', () => {
  it('holds the bin and every folder a restore lands in, once', () => {
    const from = new Map([
      ['p1', 'C:\\Docs'],
      ['p2', 'c:\\docs'],
      ['p3', 'D:\\work']
    ])
    expect(binHoldDirs(['p1', 'p2', 'p3', 'p4'], (p) => from.get(p))).toEqual([
      BIN_PLACE,
      'C:\\Docs',
      'D:\\work'
    ])
  })

  it('reads the original names for the question', () => {
    const rows = [
      { path: 'a', name: 'x.txt' },
      { path: 'b', name: 'y' }
    ]
    expect(namesOfBinPaths(['b', 'a', 'gone'], rows)).toEqual(['y', 'x.txt'])
  })

  it('says how many could not be put back', () => {
    expect(binRestoreFailure(1, 5)).toBe('1 of 5 could not be put back.')
    expect(binRestoreFailure(1, 1)).toBe('That could not be put back.')
    expect(binRestoreFailure(2, 2)).toBe('2 of 2 could not be put back.')
  })

  it('says how many could not be deleted', () => {
    expect(binDeleteFailure(1, 1)).toBe('That could not be deleted.')
    expect(binDeleteFailure(3, 9)).toBe('3 of 9 could not be deleted.')
  })

  it('the stopped line names what went through', () => {
    expect(binStopped('Restored', 120, 500)).toBe('Stopped. Restored 120 of 500.')
    expect(binStopped('Deleted', 7, 40)).toBe('Stopped. Deleted 7 of 40.')
  })
})
