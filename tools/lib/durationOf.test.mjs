import { describe, expect, it } from 'vitest'
import { durationOf } from './durationOf.mjs'

describe('durationOf (audit #97)', () => {
  it('reads the length from ffprobe', () => {
    expect(durationOf('a.mp4', () => ({ stdout: '12.5\n' }))).toBe(12.5)
    expect(durationOf('a.mp4', () => ({ stdout: '' }))).toBe(0)
  })

  it('says ffprobe is needed when it cannot start', () => {
    const missing = () => ({ error: new Error('spawnSync ffprobe ENOENT'), stdout: null })
    expect(() => durationOf('a.mp4', missing)).toThrow(/ffprobe is needed/)
  })
})