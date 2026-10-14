import { describe, expect, it } from 'vitest'
import {
  CODE_TTL_MS,
  emptyState,
  forget,
  issueCode,
  parseState,
  phoneFor,
  redeem,
  serializeState,
  touch
} from './pairing'

const fixed = (v: string) => () => v

describe('pairing', () => {
  it('issues a 6-character code from the unambiguous alphabet', () => {
    const s = emptyState()
    const code = issueCode(s, 'C:\\films', 1000)
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    expect(s.codes).toHaveLength(1)
  })

  it('redeems once, within its two minutes, and starts the phone in its folder', () => {
    const s = emptyState()
    issueCode(s, 'C:\\films', 1000, fixed('ABCDEF'))
    const phone = redeem(s, 'abcdef', 'iPhone', 2000, fixed('tok1'))
    expect(phone).toEqual({ token: 'tok1', name: 'iPhone', here: 'C:\\films', paired: 2000, seen: 2000 })
    expect(redeem(s, 'ABCDEF', 'again', 2001)).toBeNull()
    expect(s.codes).toHaveLength(0)
  })

  it('refuses an expired code', () => {
    const s = emptyState()
    const code = issueCode(s, 'C:\\films', 1000)
    expect(redeem(s, code, 'x', 1000 + CODE_TTL_MS + 1)).toBeNull()
  })

  it('a code for This PC starts the phone with no folder', () => {
    const s = emptyState()
    issueCode(s, null, 1000, fixed('CCCCCC'))
    expect(redeem(s, 'CCCCCC', 'Pixel', 1001, fixed('t'))?.here).toBeNull()
  })

  it('a fresh code for the same folder replaces the old one', () => {
    const s = emptyState()
    issueCode(s, 'C:\\films', 1000, fixed('AAAAAA'))
    issueCode(s, 'C:\\films', 1500, fixed('BBBBBB'))
    expect(s.codes.map((c) => c.code)).toEqual(['BBBBBB'])
  })

  it('finds, touches and forgets a phone', () => {
    const s = emptyState()
    const code = issueCode(s, 'C:\\films', 0)
    const p = redeem(s, code, 'Pixel', 10, fixed('tok'))!
    expect(phoneFor(s, 'tok')).toBe(p)
    expect(phoneFor(s, 'nope')).toBeNull()
    expect(phoneFor(s, undefined)).toBeNull()
    touch(s, 'tok', 99)
    expect(p.seen).toBe(99)
    expect(forget(s, 'tok')).toBe(true)
    expect(forget(s, 'tok')).toBe(false)
    expect(phoneFor(s, 'tok')).toBeNull()
  })

  it('round-trips through JSON and survives a malformed file', () => {
    const s = emptyState()
    const code = issueCode(s, 'C:\\a', 0)
    redeem(s, code, 'p', 1, fixed('t'))
    const back = parseState(serializeState(s))
    expect(back.phones).toEqual(s.phones)
    expect(back.codes).toEqual([]) // codes are never persisted
    expect(parseState('soup')).toEqual(emptyState())
    // Before 2026-10-14 a phone was on a TAB, written as `root`: where it was.
    expect(
      parseState('{"phones":[{"token":"t","name":"n","root":"C:\\\\a","paired":1,"seen":2}]}').phones
    ).toEqual([{ token: 't', name: 'n', here: 'C:\\a', paired: 1, seen: 2 }])
    expect(parseState('{"phones":"no"}')).toEqual(emptyState())
  })
})
