import { describe, expect, it } from 'vitest'
import {
  driveGlyph,
  driveName,
  driveSizes,
  freeLine,
  gaugeSteps,
  nearlyFull,
  ringDash,
  usedFraction,
  usedPercent,
  usedWidth,
  WARN_AT
} from './driveUsage'

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

describe('usedPercent', () => {
  it('is the used share, whole', () => {
    expect(usedPercent(100, 49)).toBe(51)
    expect(usedPercent(TB, TB)).toBe(0)
    expect(usedPercent(2 * TB, 0.09 * TB)).toBe(96)
    expect(usedPercent(0, 0)).toBeNull()
  })
})

describe('nearlyFull', () => {
  it('is 90% used and past', () => {
    expect(nearlyFull(100, 10)).toBe(true)
    expect(nearlyFull(100, 0)).toBe(true)
    expect(nearlyFull(100, 10.5)).toBe(false)
    expect(nearlyFull(2 * TB, 90 * GB)).toBe(true)
    expect(WARN_AT).toBe(0.9)
  })
  it('is never a warning without sizes', () => {
    expect(nearlyFull()).toBe(false)
    expect(nearlyFull(0, 0)).toBe(false)
  })
})

describe('gaugeSteps', () => {
  it('lights the used share of twenty steps', () => {
    expect(gaugeSteps(100, 49)).toBe(10)
    expect(gaugeSteps(100, 4)).toBe(19)
    expect(gaugeSteps(100, 0)).toBe(20)
  })
  it('lights one for anything in use, none for an empty drive', () => {
    expect(gaugeSteps(14.5 * GB, 14.4 * GB)).toBe(1)
    expect(gaugeSteps(100, 100)).toBe(0)
    expect(gaugeSteps()).toBe(0)
  })
  it('takes another count', () => {
    expect(gaugeSteps(100, 50, 10)).toBe(5)
  })
})

describe('ringDash', () => {
  it('is the used arc and the circle', () => {
    const c = 2 * Math.PI * 10
    expect(ringDash(0.5, 10)).toBe(`${(c / 2).toFixed(2)} ${c.toFixed(2)}`)
    expect(ringDash(1, 10)).toBe(`${c.toFixed(2)} ${c.toFixed(2)}`)
  })
  it('is never quite nothing, and never past the circle', () => {
    expect(ringDash(0, 10).startsWith('0.01 ')).toBe(true)
    expect(ringDash(2, 10).split(' ')[0]).toBe((2 * Math.PI * 10).toFixed(2))
  })
})

describe('driveSizes', () => {
  it('says free and total apart', () => {
    expect(driveSizes(931 * GB, 382 * GB)).toEqual({ free: '382 GB', total: '931 GB' })
    expect(driveSizes(0, 0)).toBeNull()
  })
})

describe('driveGlyph', () => {
  it('is the USB stick for a removable drive, the drive for the rest', () => {
    expect(driveGlyph('removable')).toBe('usb')
    for (const k of ['local', 'network', 'optical', undefined] as const) expect(driveGlyph(k)).toBe('drive')
  })
})
