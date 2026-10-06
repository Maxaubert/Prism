import { describe, expect, it } from 'vitest'
import { driveName, freeLine, usedFraction, usedWidth } from './driveUsage'

const GB = 1024 ** 3
const TB = 1024 ** 4

describe('driveName', () => {
  it('is the label and the letter, as File Explorer writes it', () => {
    expect(driveName('D:\\', { label: 'Data', kind: 'local' })).toBe('Data (D:)')
  })
  it('a drive with no label is called by its kind', () => {
    expect(driveName('C:\\', { label: '', kind: 'local' })).toBe('Local Disk (C:)')
    expect(driveName('E:\\', { label: '  ', kind: 'removable' })).toBe('USB Drive (E:)')
    expect(driveName('Z:\\', { kind: 'network' })).toBe('Network Drive (Z:)')
    expect(driveName('F:\\', { kind: 'optical' })).toBe('CD Drive (F:)')
  })
  it('before the labels have answered it is a Local Disk', () => {
    expect(driveName('c:\\')).toBe('Local Disk (C:)')
    expect(driveName('C:')).toBe('Local Disk (C:)')
  })
  it('a path that is not a drive root is itself', () => {
    expect(driveName('\\\\server\\share')).toBe('\\\\server\\share')
    expect(driveName('C:\\Users')).toBe('C:\\Users')
  })
})

describe('usedFraction', () => {
  it('is used over total', () => {
    expect(usedFraction(TB, TB / 4)).toBe(0.75)
    expect(usedFraction(100, 100)).toBe(0)
    expect(usedFraction(100, 0)).toBe(1)
  })
  it('stays between 0 and 1', () => {
    expect(usedFraction(100, 150)).toBe(0)
    expect(usedFraction(100, -5)).toBe(1)
  })
  it('is null without sizes that mean anything', () => {
    expect(usedFraction(undefined, 5)).toBeNull()
    expect(usedFraction(5, undefined)).toBeNull()
    expect(usedFraction(0, 0)).toBeNull()
    expect(usedFraction(NaN, 1)).toBeNull()
    expect(usedFraction(Infinity, 1)).toBeNull()
  })
})

describe('usedWidth', () => {
  it('is a percentage to one decimal', () => {
    expect(usedWidth(TB, TB / 4)).toBe('75%')
    expect(usedWidth(3, 2)).toBe('33.3%')
    expect(usedWidth(1000, 382)).toBe('61.8%')
  })
  it('is null when the fraction is', () => {
    expect(usedWidth(0, 0)).toBeNull()
  })
})

describe('freeLine', () => {
  it('says what is free of what, in the list sizes', () => {
    expect(freeLine(TB, 382 * GB)).toBe('382 GB free of 1.0 TB')
    expect(freeLine(931 * GB, 382 * GB)).toBe('382 GB free of 931 GB')
    expect(freeLine(2 * TB, 1.2 * TB)).toBe('1.2 TB free of 2.0 TB')
    expect(freeLine(64 * GB, 0)).toBe('0 B free of 64.0 GB')
  })
  it('is empty when the sizes are missing', () => {
    expect(freeLine()).toBe('')
    expect(freeLine(0, 0)).toBe('')
  })
})
