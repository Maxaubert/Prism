import { describe, expect, it } from 'vitest'
import {
  CODE_TTL_MS,
  emptyState,
  forget,
  GRACE_MS,
  IDLE_MS,
  issueCode,
  legacyId,
  parseState,
  phoneFor,
  pruneIdle,
  redeem,
  resolve,
  ROTATE_MS,
  serializeState,
  touch
} from './pairing'

const fixed = (v: string) => () => v

/** One paired phone: token 	ok, id id1, paired at 1000. */
function paired() {
  const s = emptyState()
  const code = issueCode(s, null, 1000)
  const p = redeem(s, code, 'Pixel', 1000, fixed('tok'), fixed('id1'))!
  return { s, p }
}

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
    expect(phone).toEqual({
      token: 'tok1',
      id: expect.stringMatching(/^[0-9a-f]{32}$/),
      issued: 2000,
      name: 'iPhone',
      here: 'C:\\films',
      paired: 2000,
      seen: 2000
    })
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
    touch(s, p.id, 99)
    expect(p.seen).toBe(99)
    expect(forget(s, p.id)).toBe(true)
    expect(forget(s, p.id)).toBe(false)
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
    ).toEqual([
      { token: 't', id: legacyId('t'), issued: 2, name: 'n', here: 'C:\\a', paired: 1, seen: 2 }
    ])
    expect(parseState('{"phones":"no"}')).toEqual(emptyState())
  })
})

describe('a phone token expires and rotates (2026-11-20)', () => {
  it('lets a phone in use through, and keeps its token inside the first day', () => {
    const { s, p } = paired()
    const r = resolve(s, 'tok', 1000 + ROTATE_MS - 1)
    expect(r.hit).toEqual({ phone: p, rotated: false })
    expect(p.token).toBe('tok')
  })

  it('forgets a phone unused for 30 days, and the same token then finds nothing', () => {
    const { s, p } = paired()
    const r = resolve(s, 'tok', 1000 + IDLE_MS)
    expect(r.hit).toBeNull()
    expect(r.expired).toEqual([p])
    expect(s.phones).toHaveLength(0)
    expect(resolve(s, 'tok', 1000 + IDLE_MS + 1)).toEqual({ hit: null, expired: [] })
  })

  it('counts idleness from the last use, not from pairing', () => {
    const { s, p } = paired()
    touch(s, p.id, 1000 + IDLE_MS - 5)
    expect(resolve(s, 'tok', 1000 + IDLE_MS + 5, fixed('new')).hit?.phone).toBe(p)
  })

  it('gives a phone in use a new token after a day, and the old one dies after a short grace', () => {
    const { s, p } = paired()
    const at = 1000 + ROTATE_MS
    const r = resolve(s, 'tok', at, fixed('new'))
    expect(r.hit).toEqual({ phone: p, rotated: true })
    expect(p.token).toBe('new')
    expect(p.id).toBe('id1') // who it is does not change
    // In flight on the old token: still served, and no second rotation.
    expect(resolve(s, 'tok', at + 1000, fixed('x')).hit).toEqual({ phone: p, rotated: false })
    expect(p.token).toBe('new')
    // The new one works; the old one is refused once the grace is over.
    expect(resolve(s, 'new', at + 2000).hit?.phone).toBe(p)
    expect(resolve(s, 'tok', at + GRACE_MS).hit).toBeNull()
  })

  it('rotates at most once a day', () => {
    const { s, p } = paired()
    resolve(s, 'tok', 1000 + ROTATE_MS, fixed('t2'))
    expect(resolve(s, 't2', 1000 + ROTATE_MS + 60_000, fixed('t3')).hit?.rotated).toBe(false)
    expect(p.token).toBe('t2')
    expect(resolve(s, 't2', 1000 + 2 * ROTATE_MS, fixed('t3')).hit?.rotated).toBe(true)
    expect(p.token).toBe('t3')
  })

  it('prunes a phone that never came back, so it does not sit on the list for ever', () => {
    const { s, p } = paired()
    expect(pruneIdle(s, 1000 + IDLE_MS - 1)).toEqual([])
    expect(pruneIdle(s, 1000 + IDLE_MS)).toEqual([p])
    expect(s.phones).toHaveLength(0)
  })

  it('knows nothing of an empty or wrong token', () => {
    const { s } = paired()
    expect(resolve(s, null, 1001)).toEqual({ hit: null, expired: [] })
    expect(resolve(s, 'nope', 1001)).toEqual({ hit: null, expired: [] })
  })

  it('keeps the rotation across a restart', () => {
    const { s } = paired()
    resolve(s, 'tok', 1000 + ROTATE_MS, fixed('new'))
    const back = parseState(serializeState(s))
    expect(back.phones[0]).toMatchObject({ token: 'new', id: 'id1', prev: { token: 'tok' } })
  })
})