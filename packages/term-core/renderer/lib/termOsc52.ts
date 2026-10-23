import { OSC52_MAX } from '../../shared/termLimits'

export { OSC52_MAX }

// OSC 52, WRITE-ONLY (#176; rule replies-only-when-asked). A program in a tab
// (Claude Code's /copy, or anything at the other end of an ssh) may put text
// ON the clipboard; nothing in a tab may READ it this way, since the reply
// would hand the user's clipboard to whatever is running, local or remote.
// xterm 6.0.0 has no OSC 52 handler at all, so before this the copy was
// silently dropped. Pure: the panel registers the handler and sends a write
// through main (`writeClipboardFromTerm`).

export type Osc52 = { kind: 'write'; text: string } | { kind: 'read' }

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * `Pc;Pd`. Pc must be exactly `c` or empty (the clipboard): the primary
 * selection and lists of several are refused, since only the clipboard is a
 * thing Windows has. `Pd` `?` is a read: named, so the handler swallows it,
 * and never answered. Base64 is checked by shape before it is decoded, and an
 * encoded length past what `max` characters could need is refused unread.
 * Decoded as strict UTF-8; invalid is refused. Empty Pd (a "clear") is
 * ignored: a program must not be able to wipe what the user copied.
 */
export function parseOsc52(data: string, max: number): Osc52 | null {
  const semi = data.indexOf(';')
  if (semi < 0) return null
  const pc = data.slice(0, semi)
  const pd = data.slice(semi + 1)
  if (pc !== '' && pc !== 'c') return null
  if (pd === '?') return { kind: 'read' }
  if (!pd || pd.length % 4 !== 0 || !BASE64.test(pd)) return null
  // Every UTF-16 unit is at most 3 UTF-8 bytes, so `max` characters are at
  // most 3 * max bytes, which base64 makes 4 * max; longer is refused without
  // decoding a byte of it. The exact cap is the character count below.
  if (pd.length > max * 4 + 4) return null
  let text: string
  try {
    const bin = atob(pd)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  if (!text || text.length > max) return null
  return { kind: 'write', text }
}
