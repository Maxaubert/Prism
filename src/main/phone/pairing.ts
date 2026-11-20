/**
 * Pairing a phone (2026-09-06, #104). The QR carries a six-character code,
 * single-use and two minutes long; the phone trades it for a token it keeps.
 * The code carries the folder the PC was showing (`start`, null for This
 * PC), which is where a phone STARTS; after that the token remembers the
 * folder it was last in (`here`, 2026-10-14). Pure: the server owns the clock
 * and the randomness.
 */
import { createHash, randomBytes } from 'crypto'

export interface Phone {
  /** The secret the phone's cookie carries. It rotates (see `resolve`), so
   *  nothing but the cookie check reads it. */
  token: string
  /** Who the phone is, for good: grants, jobs and the PC's list key on this,
   *  so a new token costs a phone nothing. Never sent to the phone. */
  id: string
  /** The token before the last rotation, good for a short grace so requests
   *  already in flight still land. */
  prev?: { token: string; until: number }
  /** When the current token was issued. */
  issued: number
  name: string
  /** The folder it was last in; null is This PC. */
  here: string | null
  paired: number
  seen: number
}

export interface PairState {
  codes: Array<{ code: string; start: string | null; expires: number }>
  phones: Phone[]
}

export const CODE_TTL_MS = 2 * 60 * 1000

/** A phone unused this long is forgotten and pairs again (2026-11-20). */
export const IDLE_MS = 30 * 24 * 60 * 60 * 1000
/** A phone in use gets a fresh token at most this often. */
export const ROTATE_MS = 24 * 60 * 60 * 1000
/** How long the old token still works after a rotation. */
export const GRACE_MS = 5 * 60 * 1000

/** No 0/O, 1/I: the code is read off a screen and typed by hand as well as scanned. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomCode(): string {
  const bytes = randomBytes(6)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

function randomToken(): string {
  return randomBytes(32).toString('hex')
}

function randomId(): string {
  return randomBytes(16).toString('hex')
}

/** The id of a phone saved before ids existed: a hash of its token, so the
 *  token itself is never the key. */
export function legacyId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32)
}

export function emptyState(): PairState {
  return { codes: [], phones: [] }
}

/** A new code that starts a phone at `start`, replacing any older code for
 *  the same folder. */
export function issueCode(
  s: PairState,
  start: string | null,
  now: number,
  rnd: () => string = randomCode
): string {
  s.codes = s.codes.filter((c) => c.start !== start && c.expires > now)
  const code = rnd()
  s.codes.push({ code, start, expires: now + CODE_TTL_MS })
  return code
}

/** Trade a code for a phone. Null when unknown, spent or expired. */
export function redeem(
  s: PairState,
  code: string,
  name: string,
  now: number,
  rnd: () => string = randomToken,
  rndId: () => string = randomId
): Phone | null {
  const want = code.trim().toUpperCase()
  const i = s.codes.findIndex((c) => c.code === want)
  if (i < 0) return null
  const [hit] = s.codes.splice(i, 1)
  if (hit.expires <= now) return null
  const phone: Phone = {
    token: rnd(),
    id: rndId(),
    issued: now,
    name: name.slice(0, 80) || 'Phone',
    here: hit.start,
    paired: now,
    seen: now
  }
  s.phones.push(phone)
  return phone
}

export function phoneFor(s: PairState, token: string | null | undefined): Phone | null {
  if (!token) return null
  return s.phones.find((p) => p.token === token) ?? null
}

export interface Resolved {
  phone: Phone
  /** The phone's token changed on this request: its cookie must be reset. */
  rotated: boolean
}

/**
 * The one place a cookie token becomes a phone (2026-11-20). Phones unused
 * for IDLE_MS are forgotten first (`pruneIdle`, returned as `expired` so the
 * caller can drop their grants). No hit when the token is unknown or was
 * replaced and its grace is over. A phone on its current token for
 * ROTATE_MS or more gets a new one, and the old one keeps working for
 * GRACE_MS. A request on the old token never rotates again.
 */
export function resolve(
  s: PairState,
  token: string | null | undefined,
  now: number,
  rnd: () => string = randomToken
): { hit: Resolved | null; expired: Phone[] } {
  const expired = pruneIdle(s, now)
  if (!token) return { hit: null, expired }
  const phone = s.phones.find(
    (p) => p.token === token || (p.prev?.token === token && p.prev.until > now)
  )
  if (!phone) return { hit: null, expired }
  if (phone.prev && phone.prev.until <= now) delete phone.prev
  if (phone.token === token && now - phone.issued >= ROTATE_MS) {
    phone.prev = { token: phone.token, until: now + GRACE_MS }
    phone.token = rnd()
    phone.issued = now
    return { hit: { phone, rotated: true }, expired }
  }
  return { hit: { phone, rotated: false }, expired }
}

/** Forget every phone unused for IDLE_MS, and say which. Called on every
 *  phone request and whenever the PC lists its phones, so a phone that never
 *  comes back does not stay on the list for ever. */
export function pruneIdle(s: PairState, now: number): Phone[] {
  const gone = s.phones.filter((p) => now - p.seen >= IDLE_MS)
  if (gone.length) s.phones = s.phones.filter((p) => !gone.includes(p))
  return gone
}

export function touch(s: PairState, id: string, now: number): void {
  const p = s.phones.find((x) => x.id === id)
  if (p) p.seen = now
}

/** Forget a phone by its id. */
export function forget(s: PairState, id: string): boolean {
  const before = s.phones.length
  s.phones = s.phones.filter((p) => p.id !== id)
  return s.phones.length !== before
}

/** Codes are never persisted: a code that survives a restart is a door left open. */
export function serializeState(s: PairState): string {
  return JSON.stringify({ phones: s.phones }, null, 2)
}

export function parseState(raw: string): PairState {
  try {
    const j = JSON.parse(raw) as { phones?: unknown }
    if (!j || typeof j !== 'object' || !Array.isArray(j.phones)) return emptyState()
    // A store from before 2026-10-14 names the TAB a phone was on as `root`:
    // that folder is where it was, so it becomes `here`.
    const phones = j.phones.flatMap((raw): Phone[] => {
      if (!raw || typeof raw !== 'object') return []
      const p = raw as Partial<Phone> & { root?: unknown }
      if (typeof p.token !== 'string' || typeof p.name !== 'string') return []
      if (typeof p.paired !== 'number' || typeof p.seen !== 'number') return []
      const here = typeof p.here === 'string' ? p.here : typeof p.root === 'string' ? p.root : null
      // A phone saved before 2026-11-20 has no id and no issue time: its id
      // comes from its token, and the token counts as issued when last seen.
      const id = typeof p.id === 'string' && p.id ? p.id : legacyId(p.token)
      const issued = typeof p.issued === 'number' ? p.issued : p.seen
      const prev =
        p.prev && typeof p.prev.token === 'string' && typeof p.prev.until === 'number'
          ? { token: p.prev.token, until: p.prev.until }
          : undefined
      return [
        { token: p.token, id, issued, ...(prev ? { prev } : {}), name: p.name, here, paired: p.paired, seen: p.seen }
      ]
    })
    return { codes: [], phones }
  } catch {
    return emptyState()
  }
}
