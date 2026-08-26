import { describe, expect, it } from 'vitest'
import { formatBytes, formatTime, formatWhen, savedPercent } from './format'

describe('formatBytes', () => {
  it('keeps bytes as bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(824)).toBe('824 B')
  })
  it('shows one decimal until three digits', () => {
    expect(formatBytes(2.4 * 1024)).toBe('2.4 KB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB')
    expect(formatBytes(512 * 1024 * 1024)).toBe('512 MB')
  })
  it('climbs the units', () => {
    expect(formatBytes(3.2 * 1024 ** 3)).toBe('3.2 GB')
    expect(formatBytes(1024 ** 4 * 2)).toBe('2.0 TB')
  })
  it('is empty for nonsense', () => {
    expect(formatBytes(-1)).toBe('')
    expect(formatBytes(NaN)).toBe('')
  })
})

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(83)).toBe('1:23')
    expect(formatTime(3671)).toBe('1:01:11')
  })
})

describe('formatWhen', () => {
  it('reads as a date a human can say out loud', () => {
    expect(formatWhen(new Date(2026, 6, 4, 17, 14, 30).getTime())).toBe('4 Jul 2026 17:14')
  })

  it('pads the clock but not the day, the way a date is written', () => {
    expect(formatWhen(new Date(2026, 0, 9, 3, 5, 0).getTime())).toBe('9 Jan 2026 03:05')
  })

  it('says nothing when the container carried no time', () => {
    expect(formatWhen(undefined)).toBe('')
    expect(formatWhen(0)).toBe('')
    expect(formatWhen(Number.NaN)).toBe('')
  })
})

describe('savedPercent', () => {
  it('reports the saving, not the ratio', () => {
    expect(savedPercent(1000, 250)).toBe('75%')
  })

  it('says nothing for a stored member, which saved nothing', () => {
    expect(savedPercent(1000, 1000)).toBe('')
  })

  it('says nothing when the container grew the member instead', () => {
    // Tiny files come out bigger; "-4%" in a column of savings is noise.
    expect(savedPercent(100, 104)).toBe('')
  })

  it('never says 100%, which would read as "all of it"', () => {
    expect(savedPercent(10_000, 3)).toBe('99%')
  })

  it('says nothing about an empty member, or one with no packed size', () => {
    expect(savedPercent(0, 0)).toBe('')
    expect(savedPercent(1000, undefined)).toBe('')
  })
})
