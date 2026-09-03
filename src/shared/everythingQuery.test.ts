import { describe, expect, it } from 'vitest'
import { everythingArgs, filetimeToMs, isDirAttr, isHiddenAttr } from './everythingQuery'
import { parseQuery } from './searchQuery'

describe('Prism search terms in Everything syntax', () => {
  it('words stay words, and are ANDed by being separate arguments', () => {
    expect(everythingArgs(parseQuery('holiday 2024'))).toEqual(['holiday', '2024'])
  })

  it('a phrase reaches es.exe in quotes, so the space does not split it', () => {
    expect(everythingArgs(parseQuery('"two words"'))).toEqual(['"two words"'])
  })

  it('globs and ext: pass through; an exclusion becomes !', () => {
    expect(everythingArgs(parseQuery('*.mp4 ext:mkv -raw'))).toEqual(['*.mp4', 'ext:mkv', '!raw'])
    expect(everythingArgs(parseQuery('-"family dinner"'))).toEqual(['!"family dinner"'])
  })

  it('a bare .mp4 stays a substring, as the sidebar promises', () => {
    expect(everythingArgs(parseQuery('.mp4'))).toEqual(['.mp4'])
  })

  it('FILETIME converts to epoch milliseconds', () => {
    // Built rather than written as a literal: any modern FILETIME is past
    // 2^53, and es's own JSON already carries that rounding.
    const when = Date.UTC(2026, 8, 3, 14, 59, 58)
    const ft = (when + 11644473600000) * 10000
    expect(Math.abs(filetimeToMs(ft) - when)).toBeLessThan(2)
    expect(filetimeToMs(116444736000000000)).toBe(0) // the epoch itself
  })

  it('reads the directory and hidden bits', () => {
    expect(isDirAttr(16)).toBe(true)
    expect(isDirAttr(32)).toBe(false)
    expect(isHiddenAttr(2 | 32)).toBe(true)
    expect(isHiddenAttr(32)).toBe(false)
  })
})
