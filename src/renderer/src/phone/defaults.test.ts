import { describe, expect, it } from 'vitest'
import { phoneWrapDefault } from './defaults'

const storage = (v: string | null): Pick<Storage, 'getItem'> => ({ getItem: () => v })

describe('phoneWrapDefault', () => {
  it('turns wrapping on for a phone that has never chosen', () => {
    expect(phoneWrapDefault(storage(null))).toBe('on')
  })
  it('leaves a choice alone, whichever way it went', () => {
    expect(phoneWrapDefault(storage('off'))).toBeNull()
    expect(phoneWrapDefault(storage('on'))).toBeNull()
  })
  it('treats a value it does not know as no choice', () => {
    // codePrefs reads anything but on/off as auto, so this phone has not
    // chosen either and gets the phone's default like a fresh one.
    expect(phoneWrapDefault(storage('sideways'))).toBe('on')
  })
  it('survives a storage that throws', () => {
    expect(
      phoneWrapDefault({
        getItem: () => {
          throw new Error('no storage')
        }
      })
    ).toBe('on')
  })
})
