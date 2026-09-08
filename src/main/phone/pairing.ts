/**
 * Pairing a phone (2026-09-06, #104). The QR carries a six-character code,
 * single-use and two minutes long; the phone trades it for a token it keeps,
 * and the token remembers the ROOT it was paired to (the tab the code was
 * shown from). Pure: the server owns the clock and the randomness.
 */
import { randomBytes } from 'crypto'

export interface Phone {
  token: string
  name: string
  root: string
  paired: number
  seen: number
}

export interface PairState {
  codes: Array<{ code: string; root: string; expires: number }>
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

/** A new code for `root`, replacing any older code for the same root. */
export function issueCode(
  s: PairState,
  root: string,
  now: number,
  rnd: () => string = randomCode
): string {
  s.codes = s.codes.filter((c) => c.root !== root && c.expires > now)
  const code = rnd()
  s.codes.push({ code, root, expires: now + CODE_TTL_MS })
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
    root: hit.root,
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
    const phones = j.phones.filter(
      (p): p is Phone =>
        !!p &&
        typeof p === 'object' &&
        typeof (p as Phone).token === 'string' &&
        typeof (p as Phone).name === 'string' &&
        typeof (p as Phone).root === 'string' &&
        typeof (p as Phone).paired === 'number' &&
        typeof (p as Phone).seen === 'number'
    )
    return { codes: [], phones }
  } catch {
    return emptyState()
  }
}
