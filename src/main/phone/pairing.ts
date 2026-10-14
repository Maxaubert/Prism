/**
 * Pairing a phone (2026-09-06, #104). The QR carries a six-character code,
 * single-use and two minutes long; the phone trades it for a token it keeps.
 * The code carries the folder the PC was showing (`start`, null for This
 * PC), which is where a phone STARTS; after that the token remembers the
 * folder it was last in (`here`, 2026-10-14). Pure: the server owns the clock
 * and the randomness.
 */
import { randomBytes } from 'crypto'

export interface Phone {
  token: string
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
  rnd: () => string = randomToken
): Phone | null {
  const want = code.trim().toUpperCase()
  const i = s.codes.findIndex((c) => c.code === want)
  if (i < 0) return null
  const [hit] = s.codes.splice(i, 1)
  if (hit.expires <= now) return null
  const phone: Phone = {
    token: rnd(),
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

export function touch(s: PairState, token: string, now: number): void {
  const p = phoneFor(s, token)
  if (p) p.seen = now
}

export function forget(s: PairState, token: string): boolean {
  const before = s.phones.length
  s.phones = s.phones.filter((p) => p.token !== token)
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
      return [{ token: p.token, name: p.name, here, paired: p.paired, seen: p.seen }]
    })
    return { codes: [], phones }
  } catch {
    return emptyState()
  }
}
