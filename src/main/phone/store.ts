/**
 * userData/phone.json (2026-09-06, #104): the switch, the port the server
 * settled on, and the paired phones. Codes are never written: they live two
 * minutes in memory, and one that survived a restart would be a door left
 * open. Pure: main owns the file.
 */
import { emptyState, parseState, type PairState } from './pairing'

export interface PhoneStore {
  on: boolean
  port: number | null
  /** The address phones use (#406), or null for this PC's own address. */
  address: string | null
  pairing: PairState
}

/**
 * THE ADDRESS PHONES USE (#406; owner, 2026-10-16: "so that we can support
 * custom web addresses"). Optional: a friendly name the user's own network
 * resolves (`http://prism.home`) or HTTPS through the user's own reverse
 * proxy (`https://prism.example.com`), which is what lets the token travel
 * encrypted with no certificate warning on the phone. Prism never ships a
 * certificate and never needs one of these. Only an origin is kept: http or
 * https, a host, an optional port; no user, no path, no query.
 */
export function parseAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text || text.length > 300) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname || url.username || url.password || url.search || url.hash) return null
  if (url.pathname !== '/' && url.pathname !== '') return null
  return url.origin
}

export function parseStore(raw: string): PhoneStore {
  try {
    const j = JSON.parse(raw) as { on?: unknown; port?: unknown; address?: unknown } | null
    if (!j || typeof j !== 'object') return { on: false, port: null, address: null, pairing: emptyState() }
    return {
      on: j.on === true,
      port: typeof j.port === 'number' && Number.isInteger(j.port) && j.port > 0 && j.port < 65536 ? j.port : null,
      address: parseAddress(j.address),
      pairing: parseState(raw)
    }
  } catch {
    return { on: false, port: null, address: null, pairing: emptyState() }
  }
}

export function serializeStore(s: PhoneStore): string {
  return JSON.stringify(
    { on: s.on, port: s.port, ...(s.address ? { address: s.address } : {}), phones: s.pairing.phones },
    null,
    2
  )
}
