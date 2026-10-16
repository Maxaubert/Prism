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
  pairing: PairState
}

export function parseStore(raw: string): PhoneStore {
  try {
    const j = JSON.parse(raw) as { on?: unknown; port?: unknown } | null
    if (!j || typeof j !== 'object') return { on: false, port: null, pairing: emptyState() }
    return {
      on: j.on === true,
      port: typeof j.port === 'number' && Number.isInteger(j.port) && j.port > 0 && j.port < 65536 ? j.port : null,
      pairing: parseState(raw)
    }
  } catch {
    return { on: false, port: null, pairing: emptyState() }
  }
}

export function serializeStore(s: PhoneStore): string {
  return JSON.stringify({ on: s.on, port: s.port, phones: s.pairing.phones }, null, 2)
}
