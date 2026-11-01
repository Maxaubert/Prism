import { describe, expect, it } from 'vitest'
import { iccName } from './iccName'
import { iccProfile } from './photoBytes.testkit'

describe('iccName (#78, D8)', () => {
  it('reads a version 2 profile\'s desc text', () => {
    expect(iccName(iccProfile('Display P3', 'desc'))).toBe('Display P3')
  })

  it('reads a version 4 profile\'s mluc text, English first', () => {
    expect(iccName(iccProfile('sRGB IEC61966-2.1', 'mluc'))).toBe('sRGB IEC61966-2.1')
    expect(
      iccName(
        iccProfile('', 'mluc', [
          ['de', 'DE', 'Farbraum'],
          ['en', 'US', 'Adobe RGB (1998)']
        ])
      )
    ).toBe('Adobe RGB (1998)')
  })

  it('answers null for anything that is not a profile with a name', () => {
    expect(iccName(Buffer.alloc(0))).toBeNull()
    expect(iccName(Buffer.alloc(140))).toBeNull()
    expect(iccName(Buffer.from('not an icc profile at all, just some text that is long enough'))).toBeNull()
    expect(iccName(iccProfile('   ', 'desc'))).toBeNull()
  })

  it('never reads past the end of a truncated profile', () => {
    const p = iccProfile('Display P3', 'desc')
    expect(iccName(p.subarray(0, p.length - 6))).toBeNull()
  })
})
