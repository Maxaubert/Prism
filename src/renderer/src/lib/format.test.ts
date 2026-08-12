import { describe, expect, it } from 'vitest'
import { formatBytes, formatTime } from './format'

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
